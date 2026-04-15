import os
import time
import asyncio
from typing import Callable, Optional

import numpy as np
from fastapi import HTTPException

from .easyocr_extractor import _build_reader as build_easyocr_reader
from .easyocr_extractor import extract_text as extract_easyocr


from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .paddleocr_extractor import _build_reader as build_paddleocr_reader
from .paddleocr_extractor import _extract_page_text as extract_paddle_page_text
from .paddleocr_extractor import _extract_lines_from_result as _extract_paddle_lines
from .paddleocr_extractor import extract_text as extract_paddleocr
from .pororo_extractor import _get_pororo_ocr
from .pororo_extractor import _run_ocr_on_image
from .pororo_extractor import extract_text as extract_pororo
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
    "pororo": "Pororo OCR (PDF + doc/docx/hwp)",
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
    if model == "pororo":
        return await extract_pororo(file_bytes, filename)

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

    start_time = time.time()
    extension = os.path.splitext(filename or "uploaded_file")[1].lower()

    # 동기 경로에서도 문서 확장자(doc/docx/hwp/hwpx)를 지원하도록
    # 기존 pdf_service 변환/추출 로직으로 위임한다.
    if extension in {".doc", ".docx", ".hwp", ".hwpx"}:
        from services.pdf_service import extract_text_from_pdf

        return asyncio.run(
            extract_text_from_pdf(
                file_bytes=file_bytes,
                filename=filename,
                ocr_model=model,
            )
        )

    if model == "paddleocr" and extension == ".pdf":
        try:
            import io
            import PyPDF2

            pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
            native_parts = []
            for page_idx, page in enumerate(pdf_reader.pages, start=1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    native_parts.append(f"[페이지 {page_idx}]\n{to_layout_markdown(page_text)}")
            native_text = "\n\n".join(native_parts).strip()
            if native_text:
                return {
                    "text": native_text,
                    "total_pages": len(pdf_reader.pages),
                    "successful_pages": len(native_parts),
                    "processing_time": time.time() - start_time,
                    "char_count": len(native_text),
                    "ocr_model": "pypdf2",
                }
        except Exception:
            pass

    render_scale = 2.0
    if extension == ".pdf" and model == "paddleocr":
        render_scale = float(os.getenv("PADDLE_PDF_RENDER_SCALE", "3.0"))
    images = render_input_to_images(file_bytes, extension, scale=render_scale)
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
        use_custom_model = os.getenv("PADDLE_USE_CUSTOM_MODEL", "true").lower() in {"1", "true", "yes", "on"}
        reader = build_paddleocr_reader(
            "korean",
            prefer_custom=use_custom_model,
            extension=extension,
            use_custom_det=False,
            use_custom_rec=True,
        )
        relaxed_reader = build_paddleocr_reader(
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
        default_reader = None
        default_relaxed_reader = None
        if use_custom_model:
            default_reader = build_paddleocr_reader("korean", prefer_custom=False, extension=extension)
            default_relaxed_reader = build_paddleocr_reader(
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

        for idx, image in enumerate(images, start=1):
            try:
                page_text, detected_boxes = extract_paddle_page_text(reader, image, fallback_reader=relaxed_reader)

                if not page_text and use_custom_model and default_reader is not None:
                    print(
                        f"⚠️ PaddleOCR 기본 det + 커스텀 rec 결과 없음, 전체 기본 모델 폴백 시도 "
                        f"(page={idx}, ext={extension or 'unknown'}, boxes={detected_boxes})"
                    )
                    page_text, _ = extract_paddle_page_text(default_reader, image, fallback_reader=default_relaxed_reader)

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

    if model == "pororo":
        ocr = _get_pororo_ocr()

        for idx, image in enumerate(images, start=1):
            try:
                page_text = _run_ocr_on_image(ocr, image)

                if not page_text:
                    prepared = preprocess_for_ocr(image)
                    page_text = _run_ocr_on_image(ocr, prepared)

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
            detail = "Pororo OCR 추출 결과가 비어 있습니다."
            if first_error:
                detail += f" 첫 오류: {first_error}"
            raise HTTPException(status_code=422, detail=detail)

        return {
            "text": merged,
            "total_pages": total_pages,
            "successful_pages": successful_pages,
            "processing_time": time.time() - start_time,
            "char_count": len(merged),
            "ocr_model": "pororo",
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

    raise HTTPException(
        status_code=400,
        detail=f"지원하지 않는 OCR 모델입니다: {ocr_model}. 지원 모델: {', '.join(SUPPORTED_OCR_MODELS.keys())}",
    )