import json
import datetime
from fastapi import APIRouter, Form, Depends, HTTPException, Request
from sqlalchemy.orm import Session, joinedload
from database import get_db, User, PdfDocument, log_admin_activity

documents_router = APIRouter(prefix="/documents", tags=["Admin-Documents"])

@documents_router.get("/")
def get_admin_documents(
    page: int = 1,
    limit: int = 1000,
    db: Session = Depends(get_db)
):
    """
    모든 문서 목록 조회 (관리자용)
    Args:
        page: 페이지 번호 (기본값: 1)
        limit: 한 페이지당 조회 개수 (기본값: 1000)
    """
    try:
        offset = (page - 1) * limit
        
        # User 정보와 함께 PdfDocument 조회
        documents = (
            db.query(PdfDocument)
            .options(joinedload(PdfDocument.owner))
            .order_by(PdfDocument.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        
        total_count = db.query(PdfDocument).count()
        
        return {
            "documents": [
                {
                    "id": doc.id,
                    "filename": doc.filename,
                    "created_at": doc.created_at.isoformat() if doc.created_at else None,
                    "char_count": doc.char_count,
                    "model_used": doc.model_used,
                    "ocr_model": doc.ocr_model,  # [추가] OCR 모델 포함 (프론트 모델 폴백용)
                    "translation_model": doc.translation_model,
                    "has_original_translation": bool(doc.original_translation),
                    "has_summary_translation": bool(doc.summary_translation),
                    "file_size_bytes": doc.file_size_bytes,
                    "total_pages": doc.total_pages,
                    "successful_pages": doc.successful_pages,
                    "processing_times": {
                        "extraction": float(doc.extraction_time_seconds) if doc.extraction_time_seconds else None,
                        "summary": float(doc.summary_time_seconds) if doc.summary_time_seconds else None,
                        "translation": float(doc.translation_time_seconds) if doc.translation_time_seconds else None
                    },
                    "user": {
                        "id": doc.owner.id if doc.owner else None,
                        "username": doc.owner.username if doc.owner else None,
                        "full_name": doc.owner.full_name if doc.owner else "알수없음"
                    },
                    "summary": doc.summary if doc.summary else "요약 내용이 없습니다.",
                    "extracted_text": doc.extracted_text,
                    "password": doc.password,
                    "category": doc.category,
                    "is_public": bool(doc.is_public),
                    "is_important": bool(doc.is_important),
                }
                for doc in documents
            ],
            "pagination": {
                "page": page,
                "limit": limit,
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"문서 목록 조회 실패: {str(e)}")

@documents_router.delete("/{document_id}")
def admin_delete_document(
    document_id: int,
    request: Request,
    admin_user_id: int = Form(...),
    db: Session = Depends(get_db),
):
    """
    관리자가 임의의 문서를 삭제 (관리자 전용)
    Args:
        document_id: 삭제할 문서 ID
        admin_user_id: 관리자 사용자 ID
    """
    try:
        # 관리자 권한 확인
        admin_user = db.query(User).filter(User.id == admin_user_id).first()
        if not admin_user or admin_user.role != 'admin':
            raise HTTPException(status_code=403, detail="관리자만 이용 가능합니다.")
        
        # 문서 조회
        document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
        if not document:
            raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
        
        # 삭제 전 정보 저장
        doc_filename = document.filename
        doc_owner_id = document.user_id
        
        # 문서 삭제
        db.delete(document)
        db.commit()
        
        # 관리자 활동 로그 기록
        log_admin_activity(
            db=db,
            admin_user_id=admin_user_id,
            action="DOCUMENT_DELETED",
            target_type="DOCUMENT",
            target_id=document_id,
            details=json.dumps({
                "filename": doc_filename,
                "original_user_id": doc_owner_id
            }),
            ip_address=request.client.host
        )
        
        return {
            "message": "문서가 삭제되었습니다.",
            "document_id": document_id,
            "deleted_filename": doc_filename
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"문서 삭제 실패: {str(e)}")

@documents_router.put("/{document_id}")
def admin_update_document(
    document_id: int,
    request: Request,
    admin_user_id: int = Form(...),
    extracted_text: str = Form(None),
    summary: str = Form(None),
    db: Session = Depends(get_db),
):
    """
    관리자가 임의의 문서를 수정 (관리자 전용)
    Args:
        document_id: 수정할 문서 ID
        admin_user_id: 관리자 사용자 ID
        extracted_text: 수정할 원문 (선택)
        summary: 수정할 요약 (선택)
    """
    try:
        # 관리자 권한 확인
        admin_user = db.query(User).filter(User.id == admin_user_id).first()
        if not admin_user or admin_user.role != 'admin':
            raise HTTPException(status_code=403, detail="관리자만 이용 가능합니다.")
        
        # 문서 조회
        document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
        if not document:
            raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
        
        # 필드 업데이트
        updated_fields = []
        if extracted_text is not None:
            document.extracted_text = extracted_text
            document.char_count = len(extracted_text)
            updated_fields.append("extracted_text")
        
        if summary is not None:
            document.summary = summary
            updated_fields.append("summary")
        
        document.updated_at = datetime.datetime.now()
        db.commit()
        db.refresh(document)
        
        # 관리자 활동 로그 기록
        log_admin_activity(
            db=db,
            admin_user_id=admin_user_id,
            action="DOCUMENT_UPDATED",
            target_type="DOCUMENT",
            target_id=document_id,
            details=json.dumps({
                "filename": document.filename,
                "updated_fields": updated_fields,
                "original_user_id": document.user_id
            }),
            ip_address=request.client.host
        )
        
        return {
            "message": "문서가 수정되었습니다.",
            "document_id": document_id,
            "updated_at": document.updated_at.isoformat(),
            "char_count": document.char_count
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"문서 수정 실패: {str(e)}")
