import time
import os
import tempfile

from fastapi import HTTPException

from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .pdf_page_renderer import render_input_to_images
from .pypdf2_extractor import extract_text as extract_pypdf2_text
from .types import OcrResult

_pororo_ocr = None


def _patch_pillow_antialias() -> None:
    """Backfill removed PIL.Image.ANTIALIAS for older OCR code paths."""
    try:
        from PIL import Image
    except Exception:
        return

    if hasattr(Image, "ANTIALIAS"):
        return

    try:
        Image.ANTIALIAS = Image.Resampling.LANCZOS
    except Exception:
        pass


def _patch_torchvision_vgg_model_urls() -> None:
    """Backfill removed torchvision.models.vgg.model_urls for older Pororo code."""
    try:
        import torchvision.models.vgg as vgg
    except Exception:
        return

    if hasattr(vgg, "model_urls"):
        return

    # torchvision>=0.13 removed model_urls; Pororo brainOCR still imports it.
    vgg.model_urls = {
        "vgg11": "https://download.pytorch.org/models/vgg11-8a719046.pth",
        "vgg13": "https://download.pytorch.org/models/vgg13-19584684.pth",
        "vgg16": "https://download.pytorch.org/models/vgg16-397923af.pth",
        "vgg19": "https://download.pytorch.org/models/vgg19-dcbb9e9d.pth",
        "vgg11_bn": "https://download.pytorch.org/models/vgg11_bn-6002323d.pth",
        "vgg13_bn": "https://download.pytorch.org/models/vgg13_bn-abd245e5.pth",
        "vgg16_bn": "https://download.pytorch.org/models/vgg16_bn-6c64b313.pth",
        "vgg19_bn": "https://download.pytorch.org/models/vgg19_bn-c79401a0.pth",
    }


def _get_pororo_ocr():
    global _pororo_ocr
    if _pororo_ocr is None:
        _patch_pillow_antialias()
        _patch_torchvision_vgg_model_urls()

        try:
            from pororo import Pororo
        except ImportError as exc:
            raise HTTPException(status_code=503, detail=f"pororo 미설치: {exc}")

        try:
            _pororo_ocr = Pororo(task="ocr", lang="ko", model="brainocr")
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Pororo OCR 초기화 실패: {exc}")

    return _pororo_ocr


def _extract_lines_from_result(result) -> list:
    """Pororo OCR 결과에서 텍스트 라인 목록 추출."""
    lines = []
    if isinstance(result, dict):
        for text in result.get("description", []):
            if isinstance(text, str) and text.strip():
                lines.append(text.strip())
    elif isinstance(result, list):
        for item in result:
            if isinstance(item, str) and item.strip():
                lines.append(item.strip())
    return lines


def _run_ocr_on_image(ocr, image) -> str:
    """PIL Image 한 장에 대해 Pororo OCR 실행 후 텍스트 반환."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        image.save(tmp_path, "PNG")
        result = ocr(tmp_path, detail=True)
        return "\n".join(_extract_lines_from_result(result)).strip()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


async def extract_text(contents: bytes, filename: str, lang: str = "korean") -> OcrResult:
    start_time = time.time()
    if len(contents) == 0:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    extension = filename[filename.rfind("."):].lower() if "." in filename else ""

    if extension == ".pdf":
        try:
            native = await extract_pypdf2_text(contents, filename)
            if native.get("text", "").strip():
                native["ocr_model"] = "pypdf2"
                return native
        except Exception:
            pass

    images = render_input_to_images(contents, extension)
    ocr = _get_pororo_ocr()

    parts = []
    successful_pages = 0
    first_error = None

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
            continue

    processing_time = time.time() - start_time
    merged = "\n\n".join(parts).strip()

    if not merged:
        detail = "Pororo OCR 추출 결과가 비어 있습니다."
        if first_error:
            detail += f" 첫 오류: {first_error}"
        raise HTTPException(status_code=422, detail=detail)

    return {
        "text": merged,
        "total_pages": len(images),
        "successful_pages": successful_pages,
        "processing_time": processing_time,
        "char_count": len(merged),
        "ocr_model": "pororo",
    }
