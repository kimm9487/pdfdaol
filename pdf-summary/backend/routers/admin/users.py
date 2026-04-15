import json
from fastapi import APIRouter, Form, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from database import get_db, User, PdfDocument, UserSession, AdminActivityLog, PaymentTransaction, log_admin_activity

users_router = APIRouter(prefix="/users", tags=["Admin-Users"])

# [모든 회원 조회]
@users_router.get("/")
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
@users_router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    admin_user_id: int = Form(...),
    db: Session = Depends(get_db)
):
    """
    회원 삭제 (관리자용)
    Args:
        user_id: 삭제할 사용자 ID
        admin_user_id: 관리자 사용자 ID (로그 기록용)
    """
    try:
        # 관리자 권한 확인
        admin_user = db.query(User).filter(User.id == admin_user_id).first()
        if not admin_user or admin_user.role != 'admin':
            raise HTTPException(status_code=403, detail="관리자만 이용 가능합니다.")

        # 삭제할 사용자 확인
        user_to_delete = db.query(User).filter(User.id == user_id).first()
        if not user_to_delete:
            raise HTTPException(status_code=404, detail="삭제할 사용자를 찾을 수 없습니다.")

        if user_to_delete.role == 'admin':
            raise HTTPException(status_code=400, detail="관리자 계정은 삭제할 수 없습니다.")

        if user_id == admin_user_id:
            raise HTTPException(status_code=400, detail="현재 로그인한 관리자 본인은 삭제할 수 없습니다.")
        
        # 삭제 전 사용자 정보 저장 (로그용)
        deleted_username = user_to_delete.username

        # 외래키 참조 정리 (users <- user_sessions/admin_activity_logs/pdf_documents)
        deleted_sessions = (
            db.query(UserSession)
            .filter(UserSession.user_id == user_id)
            .delete(synchronize_session=False)
        )
        deleted_logs = (
            db.query(AdminActivityLog)
            .filter(AdminActivityLog.admin_user_id == user_id)
            .delete(synchronize_session=False)
        )

        # user_id 불일치 데이터가 있어도 FK 오류 없이 삭제되도록 문서 참조 결제를 우선 정리
        owned_doc_ids = select(PdfDocument.id).where(PdfDocument.user_id == user_id)
        deleted_payments = (
            db.query(PaymentTransaction)
            .filter(
                or_(
                    PaymentTransaction.user_id == user_id,
                    PaymentTransaction.document_id.in_(owned_doc_ids),
                )
            )
            .delete(synchronize_session=False)
        )
        deleted_docs = (
            db.query(PdfDocument)
            .filter(PdfDocument.user_id == user_id)
            .delete(synchronize_session=False)
        )
        
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
            details=json.dumps({
                "deleted_username": deleted_username,
                "deleted_sessions": deleted_sessions,
                "deleted_activity_logs": deleted_logs,
                "deleted_payments": deleted_payments,
                "deleted_documents": deleted_docs
            }),
            ip_address=request.client.host
        )
        
        return {
            "message": f"사용자 '{deleted_username}'이(가) 삭제되었습니다.",
            "deleted_user_id": user_id,
            "cleanup": {
                "sessions": deleted_sessions,
                "activity_logs": deleted_logs,
                "payments": deleted_payments,
                "documents": deleted_docs
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"회원 삭제 실패: {str(e)}")
