import time
import os
import types
import warnings
import re
from pathlib import Path

from fastapi import HTTPException
import numpy as np

from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .pdf_page_renderer import render_input_to_images
from .pypdf2_extractor import extract_text as extract_pypdf2_text
from .types import OcrResult


_PADDLE_READER_CACHE = {}


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


def _should_force_cpu_for_known_gpu_instability() -> bool:
    """Avoid known Paddle 2.x + CUDA 12.x GPU crash path in OCR inference."""
    try:
        import paddle
    except Exception:
        return False

    try:
        paddle_version = str(getattr(paddle, "__version__", ""))
        cuda_version = str(getattr(getattr(paddle, "version", object()), "cuda", lambda: "")())
    except Exception:
        return False

    if not paddle_version or not cuda_version:
        return False

    paddle_major = paddle_version.split(".")[0]
    cuda_major = cuda_version.split(".")[0]
    return paddle_major == "2" and cuda_major == "12"


def _is_truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _read_non_empty_lines(file_path: str) -> list[str]:
    with open(file_path, "r", encoding="utf-8") as file:
        return [line.rstrip("\n") for line in file if line.strip()]


def _extract_first_int(pattern: str, text: str) -> int | None:
    match = re.search(pattern, text, flags=re.MULTILINE)
    if not match:
        return None
    return int(match.group(1))


def _validate_custom_rec_model(rec_dir: str, rec_dict_path: str) -> None:
    inference_yml = Path(rec_dir) / "inference.yml"
    if not inference_yml.is_file():
        warnings.warn(f"커스텀 rec 검증 건너뜀: inference.yml 없음 ({inference_yml})")
        return

    try:
        dict_lines = _read_non_empty_lines(rec_dict_path)
        inference_text = inference_yml.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"커스텀 rec 모델 검증 실패: {exc}")

    dict_count = len(dict_lines)
    ctc_out_channels = _extract_first_int(r"^\s*CTCLabelDecode:\s*(\d+)\s*$", inference_text)
    use_space_char = _is_truthy(
        re.search(r"^\s*use_space_char:\s*(true|false)\s*$", inference_text, flags=re.MULTILINE).group(1)
        if re.search(r"^\s*use_space_char:\s*(true|false)\s*$", inference_text, flags=re.MULTILINE)
        else None,
        default=True,
    )

    if ctc_out_channels is None:
        try:
            import yaml

            parsed = yaml.safe_load(inference_text) or {}
            embedded_chars = (parsed.get("PostProcess") or {}).get("character_dict")
            if isinstance(embedded_chars, list) and embedded_chars:
                embedded_count = len([ch for ch in embedded_chars if str(ch).strip()])
                if embedded_count != dict_count:
                    raise HTTPException(
                        status_code=503,
                        detail=(
                            "커스텀 rec 모델과 문자 사전이 맞지 않습니다. "
                            f"dict 줄 수={dict_count}, inference.yml character_dict={embedded_count}, "
                            f"dict={rec_dict_path}, model={rec_dir}"
                        ),
                    )
                return
        except HTTPException:
            raise
        except Exception:
            pass

        warnings.warn(f"커스텀 rec 검증 건너뜀: CTCLabelDecode 채널 수/character_dict 정보를 찾지 못함 ({inference_yml})")
        return

    allowed_channel_counts = {
        dict_count,
        dict_count + 1,
        dict_count + 2,
        dict_count + 3,
        dict_count + (2 if use_space_char else 1),
    }

    if ctc_out_channels not in allowed_channel_counts:
        raise HTTPException(
            status_code=503,
            detail=(
                "커스텀 rec 모델과 문자 사전이 맞지 않습니다. "
                f"dict 줄 수={dict_count}, rec CTC 출력 채널={ctc_out_channels}, "
                f"dict={rec_dict_path}, model={rec_dir}"
            ),
        )


def _apply_custom_model_paths(
    tuned_kwargs: dict,
    extension: str,
    use_custom_det: bool = True,
    use_custom_rec: bool = True,
) -> bool:
    custom_model_dir = os.getenv("PADDLE_CUSTOM_MODEL_DIR", "").strip()
    if not custom_model_dir:
        return False

    use_custom_model = _is_truthy(os.getenv("PADDLE_USE_CUSTOM_MODEL"), default=True)
    if not use_custom_model:
        return False

    if (extension or "").lower() == ".pdf":
        use_custom_model = _is_truthy(os.getenv("PADDLE_USE_CUSTOM_MODEL_FOR_PDF"), default=True)
        if not use_custom_model:
            return False

    det_dir = os.path.join(custom_model_dir, "det")
    rec_dir = os.path.join(custom_model_dir, "rec")
    rec_dict_candidates = [
        os.path.join(custom_model_dir, "rec_char_dict.txt"),
        os.path.join(custom_model_dir, "korean_court_dict.txt"),
    ]
    rec_dict = next((path for path in rec_dict_candidates if os.path.isfile(path)), None)

    applied = False

    if use_custom_det:
        if not os.path.isdir(det_dir):
            warnings.warn(f"커스텀 det 모델 폴더 없음, 기본 모델 사용 ({det_dir})")
        else:
            tuned_kwargs["det_model_dir"] = det_dir
            applied = True

    if use_custom_rec and os.path.isdir(rec_dir) and rec_dict:
        _validate_custom_rec_model(rec_dir, rec_dict)
        tuned_kwargs["rec_model_dir"] = rec_dir
        tuned_kwargs["rec_char_dict_path"] = rec_dict
        applied = True
    elif use_custom_rec:
        warnings.warn(f"커스텀 rec 모델 또는 dict 없음, det만 사용 ({custom_model_dir})")

    if applied:
        det_label = "custom" if "det_model_dir" in tuned_kwargs else "default"
        rec_label = "custom" if "rec_model_dir" in tuned_kwargs else "default"
        print(
            f"✅ PaddleOCR det={det_label}, rec={rec_label} 사용 "
            f"({custom_model_dir}, ext={(extension or '').lower() or 'unknown'})"
        )

    return applied


def _build_reader(
    lang: str,
    prefer_custom: bool = False,
    config_overrides: dict | None = None,
    extension: str = "",
    use_custom_det: bool = True,
    use_custom_rec: bool = True,
):
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

    _ensure_paddle_fluid_compat()

    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"paddleocr 미설치: {exc}")

    tuned_kwargs = {
        "det_db_thresh": float(os.getenv("PADDLE_DET_DB_THRESH", "0.3")),
        "det_db_box_thresh": float(os.getenv("PADDLE_DET_DB_BOX_THRESH", "0.6")),
        "det_db_unclip_ratio": float(os.getenv("PADDLE_DET_DB_UNCLIP_RATIO", "1.5")),
        "det_db_score_mode": os.getenv("PADDLE_DET_DB_SCORE_MODE", "fast"),
        "det_limit_side_len": int(os.getenv("PADDLE_DET_LIMIT_SIDE_LEN", "960")),
    }

    if config_overrides:
        tuned_kwargs.update(config_overrides)

    if prefer_custom:
        _apply_custom_model_paths(
            tuned_kwargs,
            extension=extension,
            use_custom_det=use_custom_det,
            use_custom_rec=use_custom_rec,
        )

    try:
        use_gpu = os.getenv("OCR_USE_GPU", "true").lower() in {"1", "true", "yes", "on"}

        if use_gpu and _should_force_cpu_for_known_gpu_instability():
            use_gpu = False
            warnings.warn(
                "PaddleOCR GPU 비활성화: paddle 2.x + CUDA 12.x 조합에서 C++ SIGSEGV가 발생할 수 있어 CPU로 강제 전환합니다."
            )

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


def _get_cached_reader(
    lang: str,
    prefer_custom: bool = False,
    config_overrides: dict | None = None,
    extension: str = "",
    use_custom_det: bool = True,
    use_custom_rec: bool = True,
):
    override_items = tuple(sorted((config_overrides or {}).items()))
    cache_key = (
        lang,
        prefer_custom,
        override_items,
        extension.lower(),
        use_custom_det,
        use_custom_rec,
    )
    if cache_key not in _PADDLE_READER_CACHE:
        _PADDLE_READER_CACHE[cache_key] = _build_reader(
            lang,
            prefer_custom=prefer_custom,
            config_overrides=dict(config_overrides or {}),
            extension=extension,
            use_custom_det=use_custom_det,
            use_custom_rec=use_custom_rec,
        )
    return _PADDLE_READER_CACHE[cache_key]


def _normalize_ocr_text(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""

    text = "".join(ch for ch in text if ch.isprintable())
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _count_detected_boxes(result) -> int:
    if not result:
        return 0

    if isinstance(result, list) and result and isinstance(result[0], dict):
        total = 0
        for page in result:
            rec_texts = page.get("rec_texts") or []
            dt_polys = page.get("dt_polys") or []
            total += max(len(rec_texts), len(dt_polys))
        return total

    total = 0
    for line in result or []:
        if isinstance(line, list):
            total += len(line)
    return total


def _crop_document_region(image):
    from PIL import ImageOps

    gray = ImageOps.grayscale(image)
    array = np.array(gray)
    mask = array < int(os.getenv("PADDLE_CROP_WHITE_THRESHOLD", "245"))

    if not mask.any():
        return image

    ys, xs = np.where(mask)
    top, bottom = ys.min(), ys.max()
    left, right = xs.min(), xs.max()

    padding = int(os.getenv("PADDLE_CROP_PADDING", "28"))
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding + 1)
    bottom = min(image.height, bottom + padding + 1)

    cropped = image.crop((left, top, right, bottom))
    if cropped.width < max(200, image.width * 0.35) or cropped.height < max(200, image.height * 0.35):
        return image
    return cropped


def _image_to_bgr(image) -> np.ndarray:
    return np.array(image.convert("RGB"))[:, :, ::-1]


def _iter_page_variants(image):
    cropped = _crop_document_region(image)
    prepared = preprocess_for_ocr(image)
    prepared_cropped = preprocess_for_ocr(cropped)

    variants = [
        ("original", image),
        ("cropped", cropped),
        ("preprocessed", prepared),
        ("preprocessed_cropped", prepared_cropped),
    ]

    seen_shapes = set()
    for name, variant in variants:
        key = (variant.size, variant.mode, variant.tobytes()[:64])
        if key in seen_shapes:
            continue
        seen_shapes.add(key)
        yield name, variant


def _extract_page_text(reader, image, fallback_reader=None) -> tuple[str, int]:
    best_text = ""
    best_boxes = -1

    for _, variant in _iter_page_variants(image):
        result = reader.ocr(_image_to_bgr(variant))
        lines = _extract_lines_from_result(result)
        page_text = "\n".join(lines).strip()
        box_count = _count_detected_boxes(result)

        if page_text:
            return page_text, box_count
        if box_count > best_boxes:
            best_boxes = box_count

    if fallback_reader is None:
        return best_text, max(best_boxes, 0)

    for _, variant in _iter_page_variants(image):
        result = fallback_reader.ocr(_image_to_bgr(variant))
        lines = _extract_lines_from_result(result)
        page_text = "\n".join(lines).strip()
        box_count = _count_detected_boxes(result)
        if page_text:
            return page_text, box_count
        if box_count > best_boxes:
            best_boxes = box_count

    return best_text, max(best_boxes, 0)


def _extract_lines_from_result(result) -> list:
    lines = []
    min_conf = float(os.getenv("PADDLE_REC_MIN_CONF", "0.55"))

    if isinstance(result, list) and result and isinstance(result[0], dict):
        for page in result:
            rec_texts = page.get("rec_texts") or []
            rec_scores = page.get("rec_scores") or []
            for i, text in enumerate(rec_texts):
                score = rec_scores[i] if i < len(rec_scores) else None
                if score is not None:
                    try:
                        if float(score) < min_conf:
                            continue
                    except Exception:
                        pass

                normalized = _normalize_ocr_text(text if isinstance(text, str) else "")
                if normalized:
                    lines.append(normalized)
        return lines

    for line in result or []:
        for item in line or []:
            if len(item) >= 2 and item[1]:
                candidate = item[1][0] if isinstance(item[1], (list, tuple)) else item[1]
                score = None
                if isinstance(item[1], (list, tuple)) and len(item[1]) > 1:
                    score = item[1][1]

                if score is not None:
                    try:
                        if float(score) < min_conf:
                            continue
                    except Exception:
                        pass

                normalized = _normalize_ocr_text(candidate if isinstance(candidate, str) else "")
                if normalized:
                    lines.append(normalized)
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

    render_scale = float(os.getenv("PADDLE_PDF_RENDER_SCALE", "3.0"))
    images = render_input_to_images(contents, extension, scale=render_scale)

    use_custom_model = _is_truthy(os.getenv("PADDLE_USE_CUSTOM_MODEL"), default=True)
    ocr = _get_cached_reader(
        "korean",
        prefer_custom=use_custom_model,
        extension=extension,
        use_custom_det=False,
        use_custom_rec=True,
    )
    relaxed_ocr = _get_cached_reader(
        "korean",
        prefer_custom=use_custom_model,
        config_overrides={
            "det_db_thresh": float(os.getenv("PADDLE_DET_DB_THRESH_RELAXED", "0.18")),
            "det_db_box_thresh": float(os.getenv("PADDLE_DET_DB_BOX_THRESH_RELAXED", "0.35")),
            "det_db_unclip_ratio": float(os.getenv("PADDLE_DET_DB_UNCLIP_RATIO_RELAXED", "2.0")),
            "det_limit_side_len": int(os.getenv("PADDLE_DET_LIMIT_SIDE_LEN_RELAXED", "1536")),
        },
        extension=extension,
        use_custom_det=False,
        use_custom_rec=True,
    )
    default_ocr = None
    default_relaxed_ocr = None
    if use_custom_model:
        default_ocr = _get_cached_reader("korean", prefer_custom=False, extension=extension)
        default_relaxed_ocr = _get_cached_reader(
            "korean",
            prefer_custom=False,
            config_overrides={
                "det_db_thresh": float(os.getenv("PADDLE_DET_DB_THRESH_RELAXED", "0.18")),
                "det_db_box_thresh": float(os.getenv("PADDLE_DET_DB_BOX_THRESH_RELAXED", "0.35")),
                "det_db_unclip_ratio": float(os.getenv("PADDLE_DET_DB_UNCLIP_RATIO_RELAXED", "2.0")),
                "det_limit_side_len": int(os.getenv("PADDLE_DET_LIMIT_SIDE_LEN_RELAXED", "1536")),
            },
            extension=extension,
        )
    parts = []
    successful_pages = 0
    first_error = None

    for idx, image in enumerate(images, start=1):
        try:
            page_text, detected_boxes = _extract_page_text(ocr, image, fallback_reader=relaxed_ocr)

            if not page_text and use_custom_model and default_ocr is not None:
                print(
                    f"⚠️ PaddleOCR 기본 det + 커스텀 rec 결과 없음, 전체 기본 모델 폴백 시도 "
                    f"(page={idx}, ext={extension or 'unknown'}, boxes={detected_boxes})"
                )
                page_text, _ = _extract_page_text(default_ocr, image, fallback_reader=default_relaxed_ocr)

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
