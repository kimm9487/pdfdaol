import time
import os
import re
import io

import fitz  # PyMuPDF
import pdfplumber
import pytesseract
from PIL import Image, ImageDraw
from fastapi import HTTPException

from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .pdf_page_renderer import render_input_to_images
from .types import OcrResult

# 🌟 1. 원래 의도하셨던 깔끔한 경로 (backend/tessdata)로 복구!
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__)) # .../backend/services/ocr
SERVICES_DIR = os.path.dirname(CURRENT_DIR)              # .../backend/services
BACKEND_DIR = os.path.dirname(SERVICES_DIR)              # .../backend
TESSDATA_DIR = os.path.join(BACKEND_DIR, "tessdata")

# 🌟 2. Tesseract가 이 폴더를 참조하도록 환경 변수 설정 (쌍따옴표 버그 원천 차단)
os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR

def clean_korean_spacing(text: str) -> str:
    if not text: return ""
    return re.sub(r'(?<=[가-힣])\s+(?=[가-힣])', '', text)

def clean_ocr_noise(text: str) -> str:
    if not text: return ""
    text = re.sub(r'-\s*\d+\s*-', '', text)
    stopwords = ["법제사법위원회", "검토보고"]
    for word in stopwords: text = text.replace(word, "")
    text = re.sub(r'(?<=[가-힣,])\n(?=[가-힣a-zA-Z])', ' ', text)
    text = re.sub(r'[|▶◆■●_]', '', text) 
    text = re.sub(r' {2,}', ' ', text)
    return text.strip()

def _extract_from_page(image, lang: str) -> str:
    windows_default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(windows_default):
        pytesseract.pytesseract.tesseract_cmd = windows_default
        
    # 🌟 버그의 주범이었던 --tessdata-dir 옵션 제거! (환경변수로 자동 인식됨)
    custom_config = '--oem 1 --psm 6 -c preserve_interword_spaces=1'
    raw_text = pytesseract.image_to_string(image, lang=lang, config=custom_config)
    return clean_korean_spacing(raw_text)

def extract_text_sync(contents: bytes, filename: str, lang: str = "kor+eng", on_page=None) -> OcrResult:
    start_time = time.time()
    if not contents: raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    extension = os.path.splitext(filename)[1].lower()
    parts = []
    successful_pages = 0
    first_error = None

    if extension == ".pdf":
        try:
            windows_default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
            if os.path.exists(windows_default):
                pytesseract.pytesseract.tesseract_cmd = windows_default

            pdf_stream_fitz = io.BytesIO(contents)
            pdf_stream_plumber = io.BytesIO(contents)

            doc_fitz = fitz.open(stream=pdf_stream_fitz, filetype="pdf")
            total_pages = len(doc_fitz)
            
            custom_table_settings = {
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
                "intersection_x_tolerance": 20,
                "intersection_y_tolerance": 20,
                "snap_tolerance": 5,
            }

            with pdfplumber.open(pdf_stream_plumber) as doc_plumber:
                for page_num in range(total_pages):
                    fitz_page = doc_fitz.load_page(page_num)
                    plumber_page = doc_plumber.pages[page_num]
                    
                    tables_info = plumber_page.find_tables(table_settings=custom_table_settings)
                    markdown_tables = []
                    bboxes = [] 
                    
                    if tables_info:
                        for table_idx, table in enumerate(tables_info, start=1):
                            bboxes.append(table.bbox) 
                            extracted_data = table.extract()
                            markdown_tables.append(f"\n#### 📊 표 {table_idx}\n")
                            for row_idx, row in enumerate(extracted_data):
                                if not any(row): continue
                                clean_row = [str(cell).replace("\n", " ").strip() if cell is not None else "" for cell in row]
                                row_text = "| " + " | ".join(clean_row) + " |"
                                markdown_tables.append(row_text)
                                if row_idx == 0: 
                                    separator = "| " + " | ".join(["---"] * len(clean_row)) + " |"
                                    markdown_tables.append(separator)
                            markdown_tables.append("\n")

                    zoom = 300 / 72
                    mat = fitz.Matrix(zoom, zoom)
                    pix = fitz_page.get_pixmap(matrix=mat)
                    pil_img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    draw = ImageDraw.Draw(pil_img)
                    
                    for bbox in bboxes:
                        x0, top, x1, bottom = bbox
                        draw.rectangle([x0 * zoom, top * zoom, x1 * zoom, bottom * zoom], fill=(255, 255, 255))

                    # 🌟 여기도 옵션 제거!
                    custom_config = '--oem 1 --psm 6 -c preserve_interword_spaces=1'
                    raw_ocr_text = pytesseract.image_to_string(pil_img, lang=lang, config=custom_config)
                    final_clean_text = clean_ocr_noise(clean_korean_spacing(raw_ocr_text))

                    page_content = f"### 📝 본문 텍스트 (OCR 추출)\n{final_clean_text}\n"
                    if markdown_tables:
                        page_content += "\n### 📊 표 데이터 (구조 추출)\n" + "".join(markdown_tables)
                    
                    parts.append(f"[페이지 {page_num + 1}]\n{page_content}")
                    successful_pages += 1
                    
                    if on_page: on_page(page_num + 1, total_pages)
                    
        except Exception as exc:
            if first_error is None: first_error = str(exc)
            raise HTTPException(status_code=500, detail=f"하이브리드 추출 오류: {str(exc)}")
            
    else:
        images = render_input_to_images(contents, extension)
        total_pages = len(images)
        for idx, image in enumerate(images, start=1):
            try:
                candidates = []
                candidates.append(_extract_from_page(image, lang=lang).strip())
                prepared = preprocess_for_ocr(image)
                candidates.append(_extract_from_page(prepared, lang=lang).strip())

                page_text = max(candidates, key=len) if candidates else ""
                if page_text:
                    parts.append(f"[페이지 {idx}]\n{to_layout_markdown(clean_ocr_noise(page_text))}")
                    successful_pages += 1
            except Exception as exc:
                if first_error is None: first_error = str(exc)
            finally:
                if on_page: on_page(idx, total_pages)

    merged = "\n\n".join(parts).strip()
    if not merged:
        raise HTTPException(status_code=422, detail="추출 결과가 비어 있습니다.")

    return {
        "text": merged,
        "total_pages": total_pages,
        "successful_pages": successful_pages,
        "processing_time": time.time() - start_time,
        "char_count": len(merged),
        "ocr_model": "tesseract_hybrid", 
    }

async def extract_text(contents: bytes, filename: str, lang: str = "kor+eng") -> OcrResult:
    return extract_text_sync(contents, filename, lang)