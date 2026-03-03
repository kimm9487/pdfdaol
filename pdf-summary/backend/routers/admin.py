import json
from fastapi import APIRouter, Form, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db, User, log_admin_activity

router = APIRouter()

# --- 관리자(Admin) 전용 데이터 API ---
# 이 API들은 리액트 프론트엔드에서 데이터를 요청할 때 사용됩니다.

@router.get("/api/admin/documents")
def get_admin_documents(db: Session = Depends(get_db)):
    try:
        # 실제 서비스에서는 pdf_documents 테이블을 조회해야 하지만,
        # 현재 테이블이 생성 전일 수 있으므로 안전하게 처리합니다.
        
        tables_result = db.execute(text("SHOW TABLES")).all()
        tables = [row[0] for row in tables_result]
        
        docs = []
        
        if "pdf_documents" in tables:
            # pdf_documents 테이블이 있는 경우 실제 데이터 조회
            result = db.execute(text("SELECT id, filename, created_at FROM pdf_documents ORDER BY created_at DESC LIMIT 50")).all()
            for row in result:
                docs.append({
                    "id": row[0],
                    "filename": row[1],
                    "created_at": str(row[2]) if row[2] else None,
                    "char_count": 0,
                    "successful_pages": 0,
                    "total_pages": 0,
                    "file_size_bytes": 0,
                    "has_original_translation": False,
                    "has_summary_translation": False,
                    "processing_times": {"extraction": 0, "summary": 0, "translation": 0}
                })
        else:
            # 테이블이 없는 경우 유저 목록이라도 보여주어 API가 동작함을 확인
            users = db.query(User).all()
            for u in users:
                docs.append({
                    "id": u.user_no,
                    "filename": f"미등록 문서(사용자: {u.user_name})",
                    "created_at": None,
                    "char_count": 0,
                    "successful_pages": 0,
                    "total_pages": 0,
                    "file_size_bytes": 0,
                    "has_original_translation": False,
                    "has_summary_translation": False,
                    "processing_times": {"extraction": 0, "summary": 0, "translation": 0}
                })

        return {
            "documents": docs,
            "pagination": {
                "total_count": len(docs),
                "page": 1,
                "total_pages": 1
            }
        }
    except Exception as e:
        print(f"Admin Documents Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"문서 목록 조회 실패: {str(e)}")

# ===== [추가] 관리자 회원 관리 API =====

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
