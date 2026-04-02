import time
import os
import types

from fastapi import HTTPException
import numpy as np

from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .pdf_page_renderer import render_input_to_images
from .pypdf2_extractor import extract_text as extract_pypdf2_text
from .types import OcrResult


def _ensure_paddle_fluid_compat() -> None:
    """Provide minimal paddle.fluid.core compat for older PaddleOCR paths."""
    try:
        import paddle
    except Exception:
        return

    if hasattr(paddle, "fluid"):
        return

    core = None
    try:
        from paddle.base import core as paddle_base_core
        core = paddle_base_core
    except Exception:
        pass

    if core is not None:
        paddle.fluid = types.SimpleNamespace(core=core)


def _build_reader(lang: str, prefer_custom: bool = False):
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

    _ensure_paddle_fluid_compat()

    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"paddleocr 미설치: {exc}")

    # 한국어 문서용 튜닝값
    tuned_kwargs = {
        "det_db_thresh": float(os.getenv("PADDLE_DET_DB_THRESH", "0.3")),
        "det_db_box_thresh": float(os.getenv("PADDLE_DET_DB_BOX_THRESH", "0.6")),
        "det_db_unclip_ratio": float(os.getenv("PADDLE_DET_DB_UNCLIP_RATIO", "1.5")),
        "det_db_score_mode": os.getenv("PADDLE_DET_DB_SCORE_MODE", "fast"),
        "det_limit_side_len": int(os.getenv("PADDLE_DET_LIMIT_SIDE_LEN", "960")),
    }

    # 이미지 입력에서만 커스텀 모델 사용 (PDF는 기본 모델 유지)
    if prefer_custom:
        custom_model_dir = os.getenv("PADDLE_CUSTOM_MODEL_DIR", "").strip()
        if custom_model_dir:
            det_dir = os.path.join(custom_model_dir, "det")
            rec_dir = os.path.join(custom_model_dir, "rec")
            if os.path.isdir(det_dir):
                tuned_kwargs["det_model_dir"] = det_dir

                # rec dict 파일이 있을 때만 커스텀 rec 사용 (없으면 기본 rec 사용)
                rec_dict_candidates = [
                    os.path.join(custom_model_dir, "rec_char_dict.txt"),
                    os.path.join(custom_model_dir, "korean_court_dict.txt"),
                ]
                rec_dict = next((path for path in rec_dict_candidates if os.path.isfile(path)), None)
                if os.path.isdir(rec_dir) and rec_dict:
                    tuned_kwargs["rec_model_dir"] = rec_dir
                    tuned_kwargs["rec_char_dict_path"] = rec_dict
                    print(f"✅ 이미지 입력: 커스텀 det+rec 사용 ({custom_model_dir})")
                else:
                    print(f"✅ 이미지 입력: 커스텀 det만 사용 ({custom_model_dir}), rec는 기본 모델")
            else:
                print(f"⚠️ 이미지 입력: det 모델 폴더 없음 ({custom_model_dir}), 기본 모델 사용")

    try:
        use_gpu = os.getenv("OCR_USE_GPU", "true").lower() in {"1", "true", "yes", "on"}
        preferred_device = os.getenv("PADDLE_DEVICE", "gpu:0" if use_gpu else "cpu")

        if use_gpu:
            try:
                return PaddleOCR(use_angle_cls=True, lang=lang, device=preferred_device, **tuned_kwargs)
            except Exception as exc:
                print(f"⚠️ PaddleOCR GPU(device) 초기화 실패, CPU 폴백 시도: {exc}")

        try:
            return PaddleOCR(use_angle_cls=True, lang=lang, device="cpu", **tuned_kwargs)
        except TypeError:
            if use_gpu:
                try:
                    return PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=True, **tuned_kwargs)
                except Exception as exc:
                    print(f"⚠️ PaddleOCR GPU(use_gpu) 초기화 실패, CPU 폴백 시도: {exc}")
            return PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=False, **tuned_kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=f"PaddleOCR 초기화 실패: {exc}")
    except ModuleNotFoundError as exc:
        if str(exc) == "No module named 'paddle'":
            raise HTTPException(status_code=503, detail="paddlepaddle 패키지가 설치되지 않았습니다. backend 의존성을 다시 설치해주세요.")
        raise HTTPException(status_code=503, detail=f"PaddleOCR 의존성 누락: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"PaddleOCR 초기화 실패: {exc}")


def _extract_lines_from_result(result) -> list:
    lines = []

    if isinstance(result, list) and result and isinstance(result[0], dict):
        for page in result:
            rec_texts = page.get("rec_texts") or []
            for text in rec_texts:
                if isinstance(text, str) and text.strip():
                    lines.append(text.strip())
        return lines

    # PaddleOCR v2: nested list format
    for line in result or []:
        for item in line or []:
            if len(item) >= 2 and item[1]:
                candidate = item[1][0] if isinstance(item[1], (list, tuple)) else item[1]
                if isinstance(candidate, str) and candidate.strip():
                    lines.append(candidate.strip())
    return lines


async def extract_text(contents: bytes, filename: str, lang: str = "korean") -> OcrResult:
    start_time = time.time()
    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    extension = filename[filename.rfind("."):].lower() if "." in filename else ""

    if extension == ".pdf":
        try:
            native = await extract_pypdf2_text(contents, filename)
            if native.get("text", "").strip():
                native["ocr_model"] = "pypdf2"
                return native
        except Exception:
            pass

    images = render_input_to_images(contents, extension)

    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".gif"}
    use_custom_for_image = extension in image_exts
    ocr = _build_reader("korean", prefer_custom=use_custom_for_image)
    parts = []
    successful_pages = 0
    first_error = None

    for idx, image in enumerate(images, start=1):
        try:
            image_bgr = np.array(image)[:, :, ::-1]
            result = ocr.ocr(image_bgr)
            lines = _extract_lines_from_result(result)

            page_text = "\n".join(lines).strip()

            if not page_text:
                prepared = preprocess_for_ocr(image)
                prepared_bgr = np.array(prepared.convert("RGB"))[:, :, ::-1]
                retry = ocr.ocr(prepared_bgr)
                retry_lines = _extract_lines_from_result(retry)
                page_text = "\n".join(retry_lines).strip()

            if page_text:
                parts.append(f"[페이지 {idx}]\n{to_layout_markdown(page_text)}")
                successful_pages += 1
        except Exception as exc:
            if first_error is None:
                first_error = str(exc)
            continue

    processing_time = time.time() - start_time
    merged = "\n\n".join(parts).strip()
    if not merged:
        detail = "PaddleOCR 추출 결과가 비어 있습니다."
        if first_error:
            detail += f" 첫 오류: {first_error}"
        raise HTTPException(status_code=422, detail=detail)

    return {
        "text": merged,
        "total_pages": len(images),
        "successful_pages": successful_pages,
        "processing_time": processing_time,
        "char_count": len(merged),
        "ocr_model": "paddleocr",
    }