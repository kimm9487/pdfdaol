from fastapi import UploadFile, HTTPException
import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory, SpooledTemporaryFile

from services.ocr import extract_with_model, list_available_ocr_models


PDF_ONLY_MODELS = {"pypdf2"}
PDF_EXTENSIONS = {".pdf"}
OCR_DOC_EXTENSIONS = {".doc", ".docx", ".hwp"}
ALLOWED_OCR_EXTENSIONS = PDF_EXTENSIONS | OCR_DOC_EXTENSIONS


def _find_soffice() -> str:
    env_path = os.getenv("LIBREOFFICE_PATH", "").strip()
    if env_path and os.path.exists(env_path):
        return env_path

    # Common Windows path + PATH lookup.
    win_default = r"C:\Program Files\LibreOffice\program\soffice.exe"
    if os.path.exists(win_default):
        return win_default

    for cmd in ["soffice", "soffice.exe"]:
        found = shutil.which(cmd)
        if found:
            return found

    return ""


def _build_upload_file_from_bytes(content: bytes, filename: str) -> UploadFile:
    temp = SpooledTemporaryFile()
    temp.write(content)
    temp.seek(0)
    return UploadFile(filename=filename, file=temp)


def _convert_document_to_pdf_bytes(content: bytes, original_name: str) -> bytes:
    soffice = _find_soffice()
    if not soffice:
        raise HTTPException(
            status_code=422,
            detail=(
                "DOC/DOCX/HWP 변환을 위해 LibreOffice가 필요합니다. "
                "LibreOffice를 설치하고 LIBREOFFICE_PATH를 설정하거나 soffice를 PATH에 추가해주세요."
            ),
        )

    original_suffix = Path(original_name).suffix.lower()
    stem = Path(original_name).stem or "document"

    with TemporaryDirectory() as tmp_dir:
        input_path = Path(tmp_dir) / f"input{original_suffix}"
        output_path = Path(tmp_dir) / f"{stem}.pdf"

        input_path.write_bytes(content)

        try:
            result = subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp_dir,
                    str(input_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=422, detail="문서 PDF 변환 시간이 초과되었습니다.")
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"문서 PDF 변환 실행 실패: {exc}")

        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            raise HTTPException(status_code=422, detail=f"문서 PDF 변환 실패: {stderr or '알 수 없는 오류'}")

        if not output_path.exists():
            # Some filters may rename output unexpectedly; try any pdf in outdir.
            pdf_candidates = list(Path(tmp_dir).glob("*.pdf"))
            if not pdf_candidates:
                raise HTTPException(status_code=422, detail="변환된 PDF 파일을 찾을 수 없습니다.")
            output_path = pdf_candidates[0]

        return output_path.read_bytes()


async def extract_text_from_pdf(file: UploadFile, ocr_model: str = "pypdf2") -> dict:
    """
    업로드된 PDF 파일에서 텍스트를 추출합니다.
    처리 시간과 상세한 결과 정보를 함께 반환합니다.
    """
    model = (ocr_model or "pypdf2").lower()
    filename = file.filename or "uploaded_file"
    extension = Path(filename).suffix.lower()

    if model in PDF_ONLY_MODELS and extension not in PDF_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "pypdf2 모델은 PDF 파일만 지원합니다.",
                "reason": "잘못된 파일 형식",
                "suggestion": "OCR 모델(tesseract/easyocr/paddleocr)을 선택하면 doc/docx/hwp도 처리할 수 있습니다."
            },
        )

    if model not in PDF_ONLY_MODELS and extension not in ALLOWED_OCR_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "지원하지 않는 파일 형식입니다.",
                "reason": f"허용 확장자: {', '.join(sorted(ALLOWED_OCR_EXTENSIONS))}",
                "suggestion": "pdf/doc/docx/hwp 파일을 업로드해주세요."
            },
        )

    if extension in PDF_EXTENSIONS:
        return await extract_with_model(file=file, ocr_model=model)

    # doc/docx/hwp 파일은 PDF로 변환 후 OCR 수행
    original_bytes = await file.read()
    await file.seek(0)

    if not original_bytes:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    pdf_bytes = _convert_document_to_pdf_bytes(original_bytes, filename)
    converted_upload = _build_upload_file_from_bytes(pdf_bytes, f"{Path(filename).stem}.pdf")
    result = await extract_with_model(file=converted_upload, ocr_model=model)
    result["source_file"] = filename
    result["converted_from"] = extension
    return result


def get_available_ocr_models() -> list:
    return list_available_ocr_models()
