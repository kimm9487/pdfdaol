import time

from fastapi import HTTPException, UploadFile
import numpy as np

from .image_preprocess import preprocess_for_ocr
from .pdf_page_renderer import render_input_to_images
from .types import OcrResult


def _build_reader(lang: str):
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"paddleocr 미설치: {exc}")

    try:
        # PaddleOCR v3 uses `device` instead of deprecated `use_gpu`.
        return PaddleOCR(use_angle_cls=True, lang=lang, device="cpu")
    except ValueError as exc:
        if "Unknown argument: use_gpu" in str(exc):
            raise HTTPException(status_code=503, detail="PaddleOCR 버전 호환 오류가 발생했습니다. 서버를 최신 코드로 재배포해주세요.")
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


async def extract_text(file: UploadFile, lang: str = "korean") -> OcrResult:
    start_time = time.time()
    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    filename = file.filename or "uploaded_file"
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
                parts.append(f"[페이지 {idx}]\n{page_text}")
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
