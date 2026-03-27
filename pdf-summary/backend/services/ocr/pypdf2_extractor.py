import io
import time

import PyPDF2
from fastapi import HTTPException, UploadFile

from .types import OcrResult


async def extract_text(file: UploadFile) -> OcrResult:
    start_time = time.time()
    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    try:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"PDF 형식 오류: {exc}")

    total_pages = len(pdf_reader.pages)
    if total_pages == 0:
        raise HTTPException(status_code=422, detail="PDF에 페이지가 없습니다.")

    extracted_text = ""
    successful_pages = 0

    for page_num, page in enumerate(pdf_reader.pages):
        try:
            page_text = page.extract_text()
            if page_text and page_text.strip():
                extracted_text += f"\n[페이지 {page_num + 1}]\n{page_text}"
                successful_pages += 1
        except Exception:
            continue

    processing_time = time.time() - start_time

    if not extracted_text.strip():
        raise HTTPException(
            status_code=422,
            detail="텍스트 추출 실패: 이미지 기반 문서일 수 있습니다. OCR 모델을 선택해 주세요.",
        )

    cleaned = extracted_text.strip()
    return {
        "text": cleaned,
        "total_pages": total_pages,
        "successful_pages": successful_pages,
        "processing_time": processing_time,
        "char_count": len(cleaned),
        "ocr_model": "pypdf2",
    }
