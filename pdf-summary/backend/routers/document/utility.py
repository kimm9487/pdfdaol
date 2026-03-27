from fastapi import APIRouter, Form, Depends, Response
from urllib.parse import quote
from services.ai_service import get_available_models
from services.pdf_service import get_available_ocr_models

utility_router = APIRouter(tags=["Document Utilities"])

@utility_router.get("/models")
async def list_models():
    """Lists available AI models for summarization."""
    models = await get_available_models()
    return {"models": models}

@utility_router.get("/ocr-models")
async def list_ocr_models():
    """Lists available OCR models for text extraction."""
    return {"ocr_models": get_available_ocr_models()}

@utility_router.post("/download-text")
async def download_summary_text(summary: str = Form(...), filename: str = Form(default="summary")):
    """Downloads a given text content as a .txt file."""
    content = summary.encode("utf-8")
    safe_filename = filename.replace(".pdf", "") + "_요약.txt"
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe_filename)}"
        },
    )
