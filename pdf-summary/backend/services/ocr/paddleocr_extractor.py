import time

from fastapi import HTTPException, UploadFile
import numpy as np

from .image_preprocess import preprocess_for_ocr
from .pdf_page_renderer import render_pdf_to_images
from .types import OcrResult


def _build_reader(lang: str):
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"paddleocr 미설치: {exc}")

    return PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=False)


async def extract_text(file: UploadFile, lang: str = "korean") -> OcrResult:
    start_time = time.time()
    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    images = render_pdf_to_images(contents)

    ocr = _build_reader(lang)
    parts = []
    successful_pages = 0
    first_error = None

    for idx, image in enumerate(images, start=1):
        try:
            image_array = np.array(image)
            result = ocr.ocr(image_array, cls=True)
            lines = []
            for line in result or []:
                for item in line or []:
                    if len(item) >= 2 and item[1]:
                        lines.append(item[1][0])

            page_text = "\n".join(lines).strip()

            if not page_text:
                prepared = preprocess_for_ocr(image)
                prepared_array = np.array(prepared)
                retry = ocr.ocr(prepared_array, cls=True)
                retry_lines = []
                for line in retry or []:
                    for item in line or []:
                        if len(item) >= 2 and item[1]:
                            retry_lines.append(item[1][0])
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
