from fastapi import APIRouter, Form, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import json
import time

from services.ai_service import translate_to_english
from database import get_db, PdfDocument, can_user_access_document, log_admin_activity

translate_router = APIRouter(tags=["Translation"])

@translate_router.post("/translate")
async def translate_text(
    request: Request,
    document_id: int = Form(...),
    user_id: int = Form(...),
    text_type: str = Form(...),
    model: str = Form(default="gemma3:latest"),
    db: Session = Depends(get_db),
):
    """
    Translates the original text or summary of a document to English and saves it to the DB.
    """
    start_time = time.time()
   
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")
   
    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
   
    if text_type == "original":
        if not doc.extracted_text:
            raise HTTPException(status_code=400, detail="원문이 없습니다.")
        text_to_translate = doc.extracted_text
        existing_translation = doc.original_translation
    elif text_type == "summary":
        if not doc.summary:
            raise HTTPException(status_code=400, detail="요약이 없습니다.")
        text_to_translate = doc.summary
        existing_translation = doc.summary_translation
    else:
        raise HTTPException(status_code=400, detail="text_type은 'original' 또는 'summary'여야 합니다.")
   
    if existing_translation and doc.translation_model == model:
        processing_time = time.time() - start_time
        return {
            "document_id": document_id,
            "text_type": text_type,
            "original_text": text_to_translate,
            "translated_text": existing_translation,
            "model_used": model,
            "processing_time": f"{processing_time:.2f}초",
            "from_cache": True,
            "original_length": len(text_to_translate),
            "translated_length": len(existing_translation)
        }
   
    try:
        translated = await translate_to_english(text_to_translate, model)
        processing_time = time.time() - start_time
       
        if text_type == "original":
            doc.original_translation = translated
        else:  # summary
            doc.summary_translation = translated
           
        doc.translation_model = model
        doc.translation_time_seconds = round(processing_time, 3)
       
        db.commit()
        db.refresh(doc)
        
        log_admin_activity(
            db=db,
            admin_user_id=user_id,
            action="DOCUMENT_TRANSLATED",
            target_type="DOCUMENT",
            target_id=document_id,
            details=json.dumps({
                "text_type": text_type,
                "model": model,
                "original_length": len(text_to_translate),
                "translated_length": len(translated)
            }),
            ip_address=request.client.host
        )
       
        return {
            "document_id": document_id,
            "text_type": text_type,
            "original_text": text_to_translate,
            "translated_text": translated,
            "model_used": model,
            "processing_time": f"{processing_time:.2f}초",
            "from_cache": False,
            "original_length": len(text_to_translate),
            "translated_length": len(translated)
        }
       
    except Exception as e:
        processing_time = time.time() - start_time
        raise HTTPException(
            status_code=500,
            detail={
                "message": "번역 중 오류가 발생했습니다.",
                "error": str(e),
                "processing_time": f"{processing_time:.2f}초"
            }
        )
