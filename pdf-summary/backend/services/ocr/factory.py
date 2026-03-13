from fastapi import HTTPException, UploadFile

from .easyocr_extractor import extract_text as extract_easyocr
from .paddleocr_extractor import extract_text as extract_paddleocr
from .pypdf2_extractor import extract_text as extract_pypdf2
from .tesseract_extractor import extract_text as extract_tesseract
from .types import OcrResult

SUPPORTED_OCR_MODELS = {
    "pypdf2": "기본 텍스트 추출 (텍스트 기반 PDF)",
    "tesseract": "Tesseract OCR (PDF + doc/docx/hwp)",
    "easyocr": "EasyOCR (PDF + doc/docx/hwp)",
    "paddleocr": "PaddleOCR (PDF + doc/docx/hwp)",
}


def list_available_ocr_models() -> list:
    return [
        {"id": model_id, "label": label}
        for model_id, label in SUPPORTED_OCR_MODELS.items()
    ]


async def extract_with_model(file: UploadFile, ocr_model: str) -> OcrResult:
    model = (ocr_model or "pypdf2").lower()

    if model == "pypdf2":
        return await extract_pypdf2(file)
    if model == "tesseract":
        return await extract_tesseract(file)
    if model == "easyocr":
        return await extract_easyocr(file)
    if model == "paddleocr":
        return await extract_paddleocr(file)

    raise HTTPException(
        status_code=400,
        detail=f"지원하지 않는 OCR 모델입니다: {ocr_model}. 지원 모델: {', '.join(SUPPORTED_OCR_MODELS.keys())}",
    )
