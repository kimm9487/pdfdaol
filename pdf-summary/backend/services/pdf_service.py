from fastapi import HTTPException
from io import BytesIO
import os
import shutil
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import zipfile
import xml.etree.ElementTree as ET

from services.ocr import extract_with_model, list_available_ocr_models


PDF_ONLY_MODELS = {"pypdf2"}
# glmocr 은 이미지/PDF 기반이므로 doc/docx/hwpx 는 LibreOffice → PDF 변환 후 처리
IMAGE_NATIVE_MODELS = {"glmocr"}
PDF_EXTENSIONS = {".pdf"}
OCR_DOC_EXTENSIONS = {".doc", ".docx", ".hwpx", ".hwp"}
OCR_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".gif"}
ALLOWED_OCR_EXTENSIONS = PDF_EXTENSIONS | OCR_DOC_EXTENSIONS | OCR_IMAGE_EXTENSIONS


def _find_soffice() -> str:
    env_path = os.getenv("LIBREOFFICE_PATH", "").strip()
    if env_path and os.path.exists(env_path):
        return env_path

    win_default = r"C:\Program Files\LibreOffice\program\soffice.exe"
    if os.path.exists(win_default):
        return win_default

    for cmd in ["soffice", "soffice.exe"]:
        found = shutil.which(cmd)
        if found:
            return found

    return ""


def _extract_text_from_docx_bytes(content: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(content)) as zf:
            xml_bytes = zf.read("word/document.xml")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"DOCX 읽기 실패: {exc}")

    try:
        root = ET.fromstring(xml_bytes)
        texts = []
        for node in root.iter():
            if node.tag.endswith("}t") and node.text:
                value = node.text.strip()
                if value:
                    texts.append(value)

        merged = "\n".join(texts).strip()
        if not merged:
            raise HTTPException(status_code=422, detail="DOCX에서 추출된 텍스트가 없습니다.")
        return merged
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"DOCX 파싱 실패: {exc}")


def _extract_text_from_hwpx_bytes(content: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(content)) as zf:
            xml_names = [n for n in zf.namelist() if n.lower().endswith(".xml")]
            if not xml_names:
                raise HTTPException(status_code=422, detail="HWPX 내부 XML을 찾을 수 없습니다.")

            texts = []
            for name in xml_names:
                try:
                    xml_bytes = zf.read(name)
                    root = ET.fromstring(xml_bytes)
                    for node in root.iter():
                        tag = node.tag.lower()
                        if (tag.endswith("}t") or tag.endswith("}text")) and node.text:
                            value = node.text.strip()
                            if value:
                                texts.append(value)
                except Exception:
                    continue

            merged = "\n".join(texts).strip()
            if not merged:
                raise HTTPException(status_code=422, detail="HWPX에서 추출된 텍스트가 없습니다.")
            return merged
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"HWPX 읽기 실패: {exc}")


def _is_hwp_ole(content: bytes) -> bool:
    HWP_SIGNATURE = b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'
    if not content.startswith(HWP_SIGNATURE):
        return False
    try:
        import olefile
        f = olefile.OleFileIO(BytesIO(content))
        streams = [s[0] for s in f.listdir() if s]
        return 'FileHeader' in streams
    except Exception:
        return False


def _extract_text_from_hwp_ole_bytes(content: bytes) -> str:
    import tempfile
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".hwp", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = subprocess.run(
            ["hwp5txt", tmp_path],
            capture_output=True,
            text=True,
            timeout=60,
        )
        text = result.stdout.strip()
        if not text:
            raise HTTPException(status_code=422, detail="HWP에서 추출된 텍스트가 없습니다.")
        return text
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=422, detail="HWP 텍스트 추출 시간이 초과되었습니다.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"HWP 텍스트 추출 실패: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _convert_document_to_pdf_bytes(content: bytes, original_name: str, forced_suffix: str = None) -> bytes:
    soffice = _find_soffice()
    if not soffice:
        raise HTTPException(
            status_code=422,
            detail=(
                "DOC/DOCX/HWP 변환을 위해 LibreOffice가 필요합니다. "
                "LibreOffice를 설치하고 LIBREOFFICE_PATH를 설정하거나 soffice를 PATH에 추가해주세요."
            ),
        )

    original_suffix = (forced_suffix or Path(original_name).suffix.lower()).lower()

    with TemporaryDirectory() as tmp_dir:
        input_path = Path(tmp_dir) / f"input{original_suffix}"
        output_path = Path(tmp_dir) / "input.pdf"

        input_path.write_bytes(content)

        try:
            commands = [
                [
                    soffice,
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp_dir,
                    str(input_path),
                ],
                [
                    soffice,
                    "--headless",
                    "--convert-to",
                    "pdf:writer_pdf_Export",
                    "--outdir",
                    tmp_dir,
                    str(input_path),
                ],
            ]

            result = None
            for cmd in commands:
                result = subprocess.run(
                    cmd,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=180,
                )
                if result.returncode == 0:
                    break
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=422, detail="문서 PDF 변환 시간이 초과되었습니다.")
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"문서 PDF 변환 실행 실패: {exc}")

        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            raise HTTPException(status_code=422, detail=f"문서 PDF 변환 실패: {stderr or '알 수 없는 오류'}")

        pdf_candidates = list(Path(tmp_dir).glob("*.pdf"))
        if output_path.exists():
            return output_path.read_bytes()
        if pdf_candidates:
            return pdf_candidates[0].read_bytes()

        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        generated = ", ".join(p.name for p in Path(tmp_dir).iterdir()) or "(없음)"
        raise HTTPException(
            status_code=422,
            detail=(
                "변환된 PDF 파일을 찾을 수 없습니다. "
                f"입력 확장자: {original_suffix}, 생성 파일: {generated}, "
                f"stdout: {stdout or '(없음)'}, stderr: {stderr or '(없음)'}"
            ),
        )


async def extract_text_from_pdf(file_bytes: bytes, filename: str, ocr_model: str = "pypdf2") -> dict:
    model = (ocr_model or "pypdf2").lower()
    extension = Path(filename).suffix.lower()

    if not extension:
        extension = ".pdf"

    if model in PDF_ONLY_MODELS and extension not in PDF_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "pypdf2 모델은 PDF 파일만 지원합니다.",
                "reason": "잘못된 파일 형식",
                "suggestion": "OCR 모델(tesseract/easyocr/paddleocr/glmocr)을 선택하면 doc/docx/hwpx도 처리할 수 있습니다."
            },
        )

    if model not in PDF_ONLY_MODELS and extension not in ALLOWED_OCR_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "지원하지 않는 파일 형식입니다.",
                "reason": f"허용 확장자: {', '.join(sorted(ALLOWED_OCR_EXTENSIONS))}",
                "suggestion": "pdf/doc/docx/hwpx/jpg/png 등 지원 파일을 업로드해주세요."
            },
        )

    if extension == ".hwp":
        if _is_hwp_ole(file_bytes):
            # glmocr 은 이미지 기반 → LibreOffice 로 PDF 변환 후 처리
            if model in IMAGE_NATIVE_MODELS:
                try:
                    pdf_bytes = _convert_document_to_pdf_bytes(file_bytes, filename, forced_suffix=".doc")
                    result = await extract_with_model(
                        file_bytes=pdf_bytes,
                        filename=f"{Path(filename).stem}.pdf",
                        ocr_model=model,
                    )
                    result["source_file"] = filename
                    result["converted_from"] = ".hwp"
                    result["note"] = "HWP → PDF 변환 후 GLM-OCR 처리"
                    return result
                except HTTPException:
                    pass  # 변환 실패 시 텍스트 직접 추출로 폴백
            text = _extract_text_from_hwp_ole_bytes(file_bytes)
            return {
                "text": text,
                "total_pages": 1,
                "successful_pages": 1,
                "processing_time": 0.0,
                "char_count": len(text),
                "ocr_model": model,
                "source_file": filename,
                "converted_from": ".hwp",
                "note": "HWP 직접 텍스트 추출",
            }
        raise HTTPException(
            status_code=422,
            detail=(
                "HWP 파일을 읽을 수 없습니다. "
                "파일을 .hwpx 또는 .docx/.pdf로 변환 후 업로드해주세요."
            ),
        )

    if not file_bytes:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    # PDF / 이미지
    if extension in PDF_EXTENSIONS or extension in OCR_IMAGE_EXTENSIONS:
        return await extract_with_model(
            file_bytes=file_bytes,
            filename=filename,
            ocr_model=model,
        )

    # HWPX
    if extension == ".hwpx":
        # glmocr 은 이미지 기반 → 직접 텍스트 추출 경로를 건너뛰고 항상 PDF 변환
        if model not in IMAGE_NATIVE_MODELS and file_bytes.startswith(b"PK"):
            try:
                text = _extract_text_from_hwpx_bytes(file_bytes)
                return {
                    "text": text,
                    "total_pages": 1,
                    "successful_pages": 1,
                    "processing_time": 0.0,
                    "char_count": len(text),
                    "ocr_model": model,
                    "source_file": filename,
                    "converted_from": extension,
                    "note": "HWPX 직접 텍스트 추출 경로 사용",
                }
            except HTTPException:
                pass

        conversion_errors = []
        for suffix in [".hwpx", ".doc"]:
            try:
                pdf_bytes = _convert_document_to_pdf_bytes(file_bytes, filename, forced_suffix=suffix)
                result = await extract_with_model(
                    file_bytes=pdf_bytes,
                    filename=f"{Path(filename).stem}.pdf",
                    ocr_model=model,
                )
                result["source_file"] = filename
                result["converted_from"] = extension
                result["note"] = f"HWPX 변환 경로 사용({suffix} 시도 성공)"
                return result
            except HTTPException as exc:
                conversion_errors.append(f"{suffix}: {exc.detail}")

        raise HTTPException(
            status_code=422,
            detail=(
                "HWPX 파일 변환에 실패했습니다. "
                "Docker 환경의 LibreOffice에서 해당 HWPX를 열지 못했습니다. "
                f"시도 결과: {' | '.join(conversion_errors)}"
            ),
        )

    # DOCX
    if extension == ".docx":
        # glmocr 은 이미지 기반 → 직접 텍스트 추출 경로를 건너뛰고 항상 PDF 변환
        if model not in IMAGE_NATIVE_MODELS:
            try:
                text = _extract_text_from_docx_bytes(file_bytes)
                return {
                    "text": text,
                    "total_pages": 1,
                    "successful_pages": 1,
                    "processing_time": 0.0,
                    "char_count": len(text),
                    "ocr_model": model,
                    "source_file": filename,
                    "converted_from": extension,
                    "note": "DOCX 직접 텍스트 추출 경로 사용",
                }
            except HTTPException:
                # HWP OLE 형식인 경우 직접 처리
                if _is_hwp_ole(file_bytes):
                    text = _extract_text_from_hwp_ole_bytes(file_bytes)
                    return {
                        "text": text,
                        "total_pages": 1,
                        "successful_pages": 1,
                        "processing_time": 0.0,
                        "char_count": len(text),
                        "ocr_model": model,
                        "source_file": filename,
                        "converted_from": ".hwp",
                        "note": "확장자가 .docx이나 실제 HWP 파일 - 직접 텍스트 추출",
                    }

        # glmocr 이거나 직접 추출 실패 시 → LibreOffice 변환 경로
        if _is_hwp_ole(file_bytes):
            # glmocr: HWP OLE → LibreOffice PDF 변환
            if model in IMAGE_NATIVE_MODELS:
                try:
                    pdf_bytes = _convert_document_to_pdf_bytes(file_bytes, filename, forced_suffix=".doc")
                    result = await extract_with_model(
                        file_bytes=pdf_bytes,
                        filename=f"{Path(filename).stem}.pdf",
                        ocr_model=model,
                    )
                    result["source_file"] = filename
                    result["converted_from"] = ".hwp"
                    result["note"] = "확장자가 .docx이나 실제 HWP 파일 - PDF 변환 후 GLM-OCR 처리"
                    return result
                except HTTPException:
                    pass
            text = _extract_text_from_hwp_ole_bytes(file_bytes)
            return {
                "text": text,
                "total_pages": 1,
                "successful_pages": 1,
                "processing_time": 0.0,
                "char_count": len(text),
                "ocr_model": model,
                "source_file": filename,
                "converted_from": ".hwp",
                "note": "확장자가 .docx이나 실제 HWP 파일 - 직접 텍스트 추출",
            }

        forced_suffix = ".docx"
        if file_bytes.startswith(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"):
            forced_suffix = ".doc"
        elif not file_bytes.startswith(b"PK"):
            raise HTTPException(
                status_code=422,
                detail=(
                    "DOCX 파일 형식이 올바르지 않습니다. "
                    "확장자는 .docx지만 실제 파일이 OOXML(zip) 형식이 아닙니다. "
                    "원본 파일 형식(.doc/.hwp/.pdf 등)을 확인해 주세요."
                ),
            )

        pdf_bytes = _convert_document_to_pdf_bytes(file_bytes, filename, forced_suffix=forced_suffix)
        result = await extract_with_model(
            file_bytes=pdf_bytes,
            filename=f"{Path(filename).stem}.pdf",
            ocr_model=model,
        )
        result["source_file"] = filename
        result["converted_from"] = extension
        result["note"] = "DOCX 직접 추출 실패로 변환 경로 사용"
        return result

    # doc 등 나머지 문서 변환 경로
    if _is_hwp_ole(file_bytes):
        # glmocr 은 이미지 기반 → LibreOffice PDF 변환 후 처리
        if model in IMAGE_NATIVE_MODELS:
            try:
                pdf_bytes = _convert_document_to_pdf_bytes(file_bytes, filename, forced_suffix=".doc")
                result = await extract_with_model(
                    file_bytes=pdf_bytes,
                    filename=f"{Path(filename).stem}.pdf",
                    ocr_model=model,
                )
                result["source_file"] = filename
                result["converted_from"] = ".hwp"
                result["note"] = "확장자가 .doc이나 실제 HWP 파일 - PDF 변환 후 GLM-OCR 처리"
                return result
            except HTTPException:
                pass  # 변환 실패 시 텍스트 직접 추출로 폴백
        text = _extract_text_from_hwp_ole_bytes(file_bytes)
        return {
            "text": text,
            "total_pages": 1,
            "successful_pages": 1,
            "processing_time": 0.0,
            "char_count": len(text),
            "ocr_model": model,
            "source_file": filename,
            "converted_from": ".hwp",
            "note": "확장자가 .doc이나 실제 HWP 파일 - 직접 텍스트 추출",
        }

    pdf_bytes = _convert_document_to_pdf_bytes(file_bytes, filename)
    result = await extract_with_model(
        file_bytes=pdf_bytes,
        filename=f"{Path(filename).stem}.pdf",
        ocr_model=model,
    )
    result["source_file"] = filename
    result["converted_from"] = extension
    return result


def get_available_ocr_models() -> list:
    return list_available_ocr_models()