import time
import numpy as np

from fastapi import HTTPException, UploadFile

from .image_preprocess import preprocess_for_ocr
from .pdf_page_renderer import render_pdf_to_images
from .types import OcrResult


def _build_reader(langs: list):
    try:
        import easyocr
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"easyocr 미설치: {exc}")

    return easyocr.Reader(langs, gpu=False)


async def extract_text(file: UploadFile, langs: list = None) -> OcrResult:
    start_time = time.time()
    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    if langs is None:
        langs = ["ko", "en"]

    images = render_pdf_to_images(contents)

    reader = _build_reader(langs)
    parts = []
    successful_pages = 0
    first_error = None

    for idx, image in enumerate(images, start=1):
        try:
            image_array = np.array(image)
            results = reader.readtext(image_array, detail=0, paragraph=True)
            page_text = "\n".join([text for text in results if text]).strip()

            if not page_text:
                prepared = preprocess_for_ocr(image)
                prepared_array = np.array(prepared)
                retry_results = reader.readtext(prepared_array, detail=0, paragraph=True)
                page_text = "\n".join([text for text in retry_results if text]).strip()

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
        detail = "EasyOCR 추출 결과가 비어 있습니다."
        if first_error:
            detail += f" 첫 오류: {first_error}"
        raise HTTPException(status_code=422, detail=detail)

    return {
        "text": merged,
        "total_pages": len(images),
        "successful_pages": successful_pages,
        "processing_time": processing_time,
        "char_count": len(merged),
        "ocr_model": "easyocr",
    }
