from fastapi import APIRouter, Depends, HTTPException, Body, Request, Form
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import json
import datetime

from database import get_db, PdfDocument, User, get_user_documents, can_user_access_document, log_admin_activity

class DocumentUpdateRequest(BaseModel):
    """Document update request schema"""
    user_id: int
    extracted_text: Optional[str] = None
    summary: Optional[str] = None
    filename: Optional[str] = None
    is_important: bool = False
    password: Optional[str] = None

crud_router = APIRouter(tags=["Documents CRUD"])

@crud_router.get("/documents/{document_id}")
async def get_document(
    document_id: int,
    user_id: int,
    db: Session = Depends(get_db),
):
    """Gets all information for a document by its ID (original, summary, translations)."""
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")
   
    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
       
    return {
        "id": doc.id,
        "filename": doc.filename,
        "extracted_text": doc.extracted_text,
        "summary": doc.summary,
        "original_translation": doc.original_translation,
        "summary_translation": doc.summary_translation,
        "ocr_model": doc.ocr_model,
        "model_used": doc.model_used,
        "translation_model": doc.translation_model,
        "char_count": doc.char_count,
        "file_size_bytes": doc.file_size_bytes,
        "total_pages": doc.total_pages,
        "successful_pages": doc.successful_pages,
        "extraction_time_seconds": float(doc.extraction_time_seconds) if doc.extraction_time_seconds else None,
        "summary_time_seconds": float(doc.summary_time_seconds) if doc.summary_time_seconds else None,
        "translation_time_seconds": float(doc.translation_time_seconds) if doc.translation_time_seconds else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "is_important": bool(doc.is_important),
        "password": doc.password,
        "is_public": bool(doc.is_public),
    }

@crud_router.get("/users/{user_id}/documents")
async def list_user_documents(
    user_id: int,
    limit: int = 1000,
    db: Session = Depends(get_db),
):
    """Lists all documents for a given user with detailed information."""
    documents = get_user_documents(db, user_id)
   
    return {
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "ocr_model": doc.ocr_model,
                "model_used": doc.model_used,
                "char_count": doc.char_count,
                "file_size_bytes": doc.file_size_bytes,
                "total_pages": doc.total_pages,
                "successful_pages": doc.successful_pages,
                "has_original_translation": bool(doc.original_translation),
                "has_summary_translation": bool(doc.summary_translation),
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "summary": doc.summary,
                "extracted_text": doc.extracted_text,
                "original_translation": doc.original_translation,
                "summary_translation": doc.summary_translation,
                "is_public": bool(doc.is_public),
                "is_important": bool(doc.is_important),
            } for doc in documents[:limit]
        ],
        "total_count": len(documents),
        "page": 1,
        "total_pages": 1,
    }

@crud_router.get("/users/{user_id}/history")
def get_summary_history(user_id: int, db: Session = Depends(get_db)):
    """Gets a brief summary history for a user (for MyPage)."""
    documents = get_user_documents(db, user_id)
    
    return [
        {
            "id": doc.id,
            "date": doc.created_at.strftime("%Y-%m-%d") if doc.created_at else "",
            "fileName": doc.filename,
            "model": doc.model_used,
            "status": "완료"
        } for doc in documents
    ]

@crud_router.put("/documents/{document_id}")
async def update_document(
    document_id: int,
    http_request: Request,
    request: DocumentUpdateRequest = Body(...),
    db: Session = Depends(get_db),
):
    """Updates a document (text, summary, etc.). Admins can edit any, users only their own."""
    if not can_user_access_document(db, request.user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서를 수정할 권한이 없습니다.")
    
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    
    updated_fields = []
    if request.extracted_text is not None:
        document.extracted_text = request.extracted_text
        document.char_count = len(request.extracted_text)
        updated_fields.append("extracted_text")
    
    if request.summary is not None:
        document.summary = request.summary
        updated_fields.append("summary")

    if request.filename is not None:
        document.filename = request.filename
        updated_fields.append("filename")
    
    if request.is_important:
        if not request.password or len(request.password) != 4 or not request.password.isdigit():
            raise HTTPException(status_code=400, detail="중요문서는 4자리 숫자 비밀번호가 필요합니다.")
        document.is_important = True
        document.password = request.password
        updated_fields.append("is_important")
    else:
        document.is_important = False
        document.password = None
        updated_fields.append("is_important")
    
    document.updated_at = datetime.datetime.now()
    db.commit()
    db.refresh(document)
    
    user = db.query(User).filter(User.id == request.user_id).first()
    log_admin_activity(
        db=db,
        admin_user_id=request.user_id,
        action="DOCUMENT_UPDATED",
        target_type="DOCUMENT",
        target_id=document_id,
        details=json.dumps({
            "filename": document.filename,
            "updated_fields": updated_fields,
            "updated_by_admin": user.role == 'admin' if user else False
        }),
        ip_address=http_request.client.host
    )
    
    return {
        "message": "문서가 수정되었습니다.",
        "document_id": document_id,
        "updated_at": document.updated_at.isoformat(),
        "char_count": document.char_count
    }

@crud_router.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    request: Request,
    user_id: int = Form(...),
    db: Session = Depends(get_db),
):
    """Deletes a document. Admins can delete any, users only their own."""
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서를 삭제할 권한이 없습니다.")
    
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    
    db.delete(document)
    db.commit()
    
    user = db.query(User).filter(User.id == user_id).first()
    log_admin_activity(
        db=db,
        admin_user_id=user_id,
        action="DOCUMENT_DELETED",
        target_type="DOCUMENT",
        target_id=document_id,
        details=json.dumps({
            "filename": document.filename,
            "original_user_id": document.user_id,
            "deleted_by_admin": user.role == 'admin' if user else False
        }),
        ip_address=request.client.host
    )
    
    return {"message": "문서가 삭제되었습니다.", "document_id": document_id}

@crud_router.patch("/documents/{document_id}/public")
async def toggle_document_public(
    document_id: int,
    user_id: int = Body(...),
    is_public: bool = Body(...),
    password: str = Body(None),
    db: Session = Depends(get_db),
):
    """Updates the public/private status of a document."""
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")
   
    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
   
    if not is_public:
        if password:
            if len(password) != 4 or not password.isdigit():
                raise HTTPException(status_code=400, detail="비밀번호는 숫자 4자리여야 합니다.")
            doc.password = password
            doc.is_important = True
    
    doc.is_public = is_public
    db.commit()
    db.refresh(doc)
   
    return {
        "id": doc.id,
        "filename": doc.filename,
        "is_public": doc.is_public,
        "has_password": bool(doc.password),
        "message": f"문서가 {'공개' if is_public else '비공개'} 상태로 변경되었습니다."
    }