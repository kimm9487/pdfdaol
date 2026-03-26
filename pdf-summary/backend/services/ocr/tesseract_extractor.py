import time
import os
import re

from fastapi import HTTPException

from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .pdf_page_renderer import render_input_to_images
from .types import OcrResult

# 🌟 1. 커스텀 모델이 있는 tessdata 폴더의 절대 경로 설정
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TESSDATA_DIR = os.path.join(BASE_DIR, "tessdata")

# Tesseract가 모델을 찾을 수 있도록 환경 변수 설정
os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR


def clean_korean_spacing(text: str) -> str:
    """
    Tesseract의 고질적인 한글 낱글자 띄어쓰기 오류(예: '법 원 의 설 치')를
    정규표현식을 이용해 붙여주는 후처리 함수입니다.
    """
    if not text:
        return text
    # 한글과 한글 사이의 1개 이상의 공백을 제거
    cleaned_text = re.sub(r'(?<=[가-힣])\s+(?=[가-힣])', '', text)
    return cleaned_text


def _extract_from_page(image, lang: str) -> str:
    try:
        import pytesseract
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"pytesseract 미설치: {exc}")

    windows_default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(windows_default):
        pytesseract.pytesseract.tesseract_cmd = windows_default

    # 🌟 2. [수정됨] 띄어쓰기 보존 옵션(-c preserve_interword_spaces=1) 추가
    custom_config = '--oem 1 --psm 6 -c preserve_interword_spaces=1'
    
    # 🌟 3. [수정됨] 불필요한 중복 실행(text = ...)을 제거하고 바로 return
    raw_text = pytesseract.image_to_string(image, lang=lang, config=custom_config)
    
    # 🌟 4. [수정됨] 한글 낱글자 띄어쓰기 후처리 적용
    return clean_korean_spacing(raw_text)


# 🌟 기본 언어를 "kor+eng"로 유지
async def extract_text(contents: bytes, filename: str, lang: str = "kor+eng") -> OcrResult:
    start_time = time.time()
    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    extension = os.path.splitext(filename)[1].lower()
    images = render_input_to_images(contents, extension)

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

            # English-only fallback
            if "kor" not in (lang or ""):
                candidates.append(_extract_from_page(prepared, lang="eng").strip())

            page_text = max(candidates, key=lambda x: len(x)) if candidates else ""
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
        "ocr_model": "tesseract_custom", 
    }