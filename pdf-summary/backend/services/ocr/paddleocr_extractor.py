import time
import os
<<<<<<< HEAD
import types
=======
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477

from fastapi import HTTPException
import numpy as np

from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .pdf_page_renderer import render_input_to_images
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


def _build_reader(lang: str):
<<<<<<< HEAD
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

    _ensure_paddle_fluid_compat()

=======
    # 네트워크 체크로 인한 초기화 지연/충돌을 방지합니다.
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"paddleocr 미설치: {exc}")

    try:
<<<<<<< HEAD
        use_gpu = os.getenv("OCR_USE_GPU", "true").lower() in {"1", "true", "yes", "on"}
        preferred_device = os.getenv("PADDLE_DEVICE", "gpu:0" if use_gpu else "cpu")

=======
        # PaddleOCR v3 uses `device` instead of deprecated `use_gpu`.
        use_gpu = os.getenv("OCR_USE_GPU", "true").lower() in {"1", "true", "yes", "on"}
        preferred_device = os.getenv("PADDLE_DEVICE", "gpu:0" if use_gpu else "cpu")

        # PaddleOCR v3: device 인자 사용
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
        if use_gpu:
            try:
                return PaddleOCR(use_angle_cls=True, lang=lang, device=preferred_device)
            except Exception as exc:
                print(f"⚠️ PaddleOCR GPU(device) 초기화 실패, CPU 폴백 시도: {exc}")

        try:
            return PaddleOCR(use_angle_cls=True, lang=lang, device="cpu")
        except TypeError:
<<<<<<< HEAD
=======
            # PaddleOCR v2: use_gpu 인자 사용
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
            if use_gpu:
                try:
                    return PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=True)
                except Exception as exc:
                    print(f"⚠️ PaddleOCR GPU(use_gpu) 초기화 실패, CPU 폴백 시도: {exc}")
            return PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=False)
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

    # PaddleOCR v3: list[dict] with rec_texts
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
    images = render_input_to_images(contents, extension)

    ocr = _build_reader(lang)
    parts = []
    successful_pages = 0
    first_error = None

    for idx, image in enumerate(images, start=1):
        try:
            image_array = np.array(image)
            result = ocr.ocr(image_array)
            lines = _extract_lines_from_result(result)

            page_text = "\n".join(lines).strip()

            if not page_text:
                prepared = preprocess_for_ocr(image)
                prepared_array = np.array(prepared)
                retry = ocr.ocr(prepared_array)
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