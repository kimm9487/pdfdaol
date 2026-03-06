from typing import TypedDict


class OcrResult(TypedDict):
    text: str
    total_pages: int
    successful_pages: int
    processing_time: float
    char_count: int
    ocr_model: str
