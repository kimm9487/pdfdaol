import time
import os

from fastapi import HTTPException, UploadFile

from .image_preprocess import preprocess_for_ocr
from .pdf_page_renderer import render_pdf_to_images
from .types import OcrResult


def _extract_from_page(image, lang: str) -> str:
    try:
        import pytesseract
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"pytesseract 미설치: {exc}")

    windows_default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(windows_default):
        pytesseract.pytesseract.tesseract_cmd = windows_default

    return pytesseract.image_to_string(image, lang=lang, config="--oem 3 --psm 6")


async def extract_text(file: UploadFile, lang: str = "kor+eng") -> OcrResult:
    start_time = time.time()
    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    images = render_pdf_to_images(contents)

    parts = []
    successful_pages = 0
    first_error = None
    for idx, image in enumerate(images, start=1):
        try:
            candidates = []

            # First pass: original image with requested language.
            candidates.append(_extract_from_page(image, lang=lang).strip())

            # Second pass: preprocessed image with requested language.
            prepared = preprocess_for_ocr(image)
            candidates.append(_extract_from_page(prepared, lang=lang).strip())

            # Last fallback: English only (some installations lack kor data quality).
            candidates.append(_extract_from_page(prepared, lang="eng").strip())

            page_text = max(candidates, key=lambda x: len(x)) if candidates else ""
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
        detail = "Tesseract OCR 추출 결과가 비어 있습니다."
        if first_error:
            detail += f" 첫 오류: {first_error}"
        raise HTTPException(status_code=422, detail=detail)

    return {
        "text": merged,
        "total_pages": len(images),
        "successful_pages": successful_pages,
        "processing_time": processing_time,
        "char_count": len(merged),
        "ocr_model": "tesseract",
    }
