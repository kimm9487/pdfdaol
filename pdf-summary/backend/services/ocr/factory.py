import os
import time
from typing import Callable, Optional

import numpy as np
from fastapi import HTTPException

from .easyocr_extractor import _build_reader as build_easyocr_reader
from .easyocr_extractor import extract_text as extract_easyocr


from .glmocr_extractor import extract_text as extract_glmocr
from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .paddleocr_extractor import _build_reader as build_paddleocr_reader
from .paddleocr_extractor import _extract_lines_from_result
from .paddleocr_extractor import extract_text as extract_paddleocr
from .pypdf2_extractor import extract_text as extract_pypdf2
from .pdf_page_renderer import render_input_to_images
from .tesseract_extractor import _extract_from_page
from .tesseract_extractor import extract_text as extract_tesseract
from .types import OcrResult

SUPPORTED_OCR_MODELS = {
    "pypdf2": "기본 텍스트 추출 (텍스트 기반 PDF)",
    "tesseract": "Tesseract OCR (PDF + doc/docx/hwp)",
    "easyocr": "EasyOCR (PDF + doc/docx/hwp)",
    "paddleocr": "PaddleOCR (PDF + doc/docx/hwp)",
    "glmocr": "GLM-OCR (PDF + 이미지, 고정밀 멀티모달)",
}


def list_available_ocr_models() -> list:
    return [
        {"id": model_id, "label": label}
        for model_id, label in SUPPORTED_OCR_MODELS.items()
    ]


async def extract_with_model(file_bytes: bytes, filename: str, ocr_model: str) -> OcrResult:
    model = (ocr_model or "pypdf2").lower()

    if model == "pypdf2":
        return await extract_pypdf2(file_bytes, filename)
    if model == "tesseract":
        return await extract_tesseract(file_bytes, filename)
    if model == "easyocr":
        return await extract_easyocr(file_bytes, filename)
    if model == "paddleocr":
        return await extract_paddleocr(file_bytes, filename)
    if model == "glmocr":
        return await extract_glmocr(file_bytes, filename)

    raise HTTPException(
        status_code=400,
        detail=f"지원하지 않는 OCR 모델입니다: {ocr_model}. 지원 모델: {', '.join(SUPPORTED_OCR_MODELS.keys())}",
    )


def extract_with_model_sync(
    file_bytes: bytes,
    filename: str,
    ocr_model: str,
    on_page: Optional[Callable[[int, int], None]] = None,
) -> OcrResult:
    model = (ocr_model or "pypdf2").lower()
    if model == "pypdf2":
        raise HTTPException(status_code=400, detail="pypdf2 모델은 동기 OCR 진행률 추출을 사용하지 않습니다.")

    if not file_bytes:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    extension = os.path.splitext(filename or "uploaded_file")[1].lower()
    images = render_input_to_images(file_bytes, extension)
    start_time = time.time()
    total_pages = len(images)
    parts = []
    successful_pages = 0
    first_error = None

    if model == "easyocr":
        reader = build_easyocr_reader(["ko", "en"])

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
                    parts.append(f"[페이지 {idx}]\n{to_layout_markdown(page_text)}")
                    successful_pages += 1
            except Exception as exc:
                if first_error is None:
                    first_error = str(exc)
            finally:
                if on_page:
                    on_page(idx, total_pages)

        merged = "\n\n".join(parts).strip()
        if not merged:
            detail = "EasyOCR 추출 결과가 비어 있습니다."
            if first_error:
                detail += f" 첫 오류: {first_error}"
            raise HTTPException(status_code=422, detail=detail)

        return {
            "text": merged,
            "total_pages": total_pages,
            "successful_pages": successful_pages,
            "processing_time": time.time() - start_time,
            "char_count": len(merged),
            "ocr_model": "easyocr",
        }

    if model == "paddleocr":
        reader = build_paddleocr_reader("korean")

        for idx, image in enumerate(images, start=1):
            try:
                image_array = np.array(image)
                result = reader.ocr(image_array)
                lines = _extract_lines_from_result(result)
                page_text = "\n".join(lines).strip()

                if not page_text:
                    prepared = preprocess_for_ocr(image)
                    prepared_array = np.array(prepared)
                    retry = reader.ocr(prepared_array)
                    retry_lines = _extract_lines_from_result(retry)
                    page_text = "\n".join(retry_lines).strip()

                if page_text:
                    parts.append(f"[페이지 {idx}]\n{to_layout_markdown(page_text)}")
                    successful_pages += 1
            except Exception as exc:
                if first_error is None:
                    first_error = str(exc)
            finally:
                if on_page:
                    on_page(idx, total_pages)

        merged = "\n\n".join(parts).strip()
        if not merged:
            detail = "PaddleOCR 추출 결과가 비어 있습니다."
            if first_error:
                detail += f" 첫 오류: {first_error}"
            raise HTTPException(status_code=422, detail=detail)

        return {
            "text": merged,
            "total_pages": total_pages,
            "successful_pages": successful_pages,
            "processing_time": time.time() - start_time,
            "char_count": len(merged),
            "ocr_model": "paddleocr",
        }

    if model == "tesseract":
        lang = "kor+eng"

        for idx, image in enumerate(images, start=1):
            try:
                candidates = []
                candidates.append(_extract_from_page(image, lang=lang).strip())

                prepared = preprocess_for_ocr(image)
                candidates.append(_extract_from_page(prepared, lang=lang).strip())

                if "kor" not in lang:
                    candidates.append(_extract_from_page(prepared, lang="eng").strip())

                page_text = max(candidates, key=lambda value: len(value)) if candidates else ""
                if page_text:
                    parts.append(f"[페이지 {idx}]\n{to_layout_markdown(page_text)}")
                    successful_pages += 1
            except Exception as exc:
                if first_error is None:
                    first_error = str(exc)
            finally:
                if on_page:
                    on_page(idx, total_pages)

        merged = "\n\n".join(parts).strip()
        if not merged:
            detail = "Tesseract OCR 추출 결과가 비어 있습니다."
            if first_error:
                detail += f" 첫 오류: {first_error}"
            raise HTTPException(status_code=422, detail=detail)

        return {
            "text": merged,
            "total_pages": total_pages,
            "successful_pages": successful_pages,
            "processing_time": time.time() - start_time,
            "char_count": len(merged),
            "ocr_model": "tesseract",
        }

    if model == "glmocr":
        # glmocr SDK는 내부적으로 API 서버(Ollama/vLLM)를 호출하므로
        # 진행률 콜백(on_page)은 extract_text 완료 후 일괄 호출합니다.
        import asyncio
        result = asyncio.run(extract_glmocr(file_bytes, filename))
        if on_page:
            on_page(result["total_pages"], result["total_pages"])
        return result

    raise HTTPException(
        status_code=400,
        detail=f"지원하지 않는 OCR 모델입니다: {ocr_model}. 지원 모델: {', '.join(SUPPORTED_OCR_MODELS.keys())}",
    )