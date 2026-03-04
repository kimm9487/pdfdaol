import json
from fastapi import APIRouter, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload
from database import get_db, User, PdfDocument, log_admin_activity

router = APIRouter()

# --- 관리자(Admin) 전용 API ---

@router.get("/api/admin/documents")
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
                    # ===== [추가] 공개/비공개 및 중요 문서 필드 =====
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

# [모든 회원 조회]
@router.get("/auth/users")
def get_all_users(db: Session = Depends(get_db)):
    """모든 회원 목록 조회 (관리자용)"""
    try:
        users = db.query(User).order_by(User.created_at.desc()).all()
        return [
            {
                "id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "email": user.email,
                "role": user.role,
                "created_at": user.created_at.strftime("%Y-%m-%d %H:%M:%S") if user.created_at else None,
                "is_active": user.is_active
            }
            for user in users
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"회원 목록 조회 실패: {str(e)}")

# [회원 삭제]
@router.delete("/auth/users/{user_id}")
def delete_user(user_id: int, admin_user_id: int = Form(...), db: Session = Depends(get_db)):
    """
    회원 삭제 (관리자용)
    Args:
        user_id: 삭제할 사용자 ID
        admin_user_id: 관리자 사용자 ID (로그 기록용)
    """
    try:
        # 삭제할 사용자 확인
        user_to_delete = db.query(User).filter(User.id == user_id).first()
        if not user_to_delete:
            raise HTTPException(status_code=404, detail="삭제할 사용자를 찾을 수 없습니다.")
        
        # 삭제 전 사용자 정보 저장 (로그용)
        deleted_username = user_to_delete.username
        
        # 사용자 삭제
        db.delete(user_to_delete)
        db.commit()
        
        # 삭제 로그 기록
        log_admin_activity(
            db=db,
            admin_user_id=admin_user_id,
            action="USER_DELETED",
            target_type="USER",
            target_id=user_id,
            details=json.dumps({"deleted_username": deleted_username})
        )
        
        return {
            "message": f"사용자 '{deleted_username}'이(가) 삭제되었습니다.",
            "deleted_user_id": user_id
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"회원 삭제 실패: {str(e)}")
