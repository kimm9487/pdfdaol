import json
import random
import datetime
from fastapi import APIRouter, Form, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.orm import Session
from database import get_db, User, UserSession, AdminActivityLog, PdfDocument, log_admin_activity
from utils.auth_utils import hash_password, verify_password
from utils.email_utils import send_email  # 👈 공용 메일 함수 가져오기

profile_router = APIRouter()

# 이메일 변경 인증 임시 저장소
# 구조: {"new@email.com": {"code": "123456", "expires_at": datetime, "is_verified": False}}
profile_email_verifications = {}

# [유틸리티 의존성 함수들] (기존과 동일)
def get_current_user(user_id: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="사용자가 존재하지 않습니다.")
    return user

def get_current_user_id(user_id: str = Form(...)) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="사용자 ID가 필요합니다.")
    return user_id


# ===== [추가] 1. 새 이메일 인증번호 발송 =====
@profile_router.post("/send-email-change-code")
def send_email_change_code(
    new_email: str = Form(...),
    background_tasks: BackgroundTasks = None
):
    code = str(random.randint(100000, 999999))
    expires_at = datetime.datetime.now() + datetime.timedelta(minutes=5)
    
    profile_email_verifications[new_email] = {
        "code": code,
        "expires_at": expires_at,
        "is_verified": False
    }
    
    if background_tasks:
        background_tasks.add_task(send_email, new_email, code)
    else:
        send_email(new_email, code)
        
    return {"message": "새 이메일로 인증번호가 발송되었습니다. 5분 안에 입력해주세요."}


# ===== [추가] 2. 새 이메일 인증번호 확인 =====
@profile_router.post("/verify-email-change-code")
def verify_email_change_code(new_email: str = Form(...), code: str = Form(...)):
    record = profile_email_verifications.get(new_email)
    
    if not record:
        raise HTTPException(status_code=400, detail="인증 요청 내역이 없습니다.")
    if datetime.datetime.now() > record["expires_at"]:
        raise HTTPException(status_code=400, detail="인증 시간이 만료되었습니다.")
    if record["code"] != code:
        raise HTTPException(status_code=400, detail="인증번호가 일치하지 않습니다.")
        
    record["is_verified"] = True
    return {"message": "새 이메일 인증이 완료되었습니다."}


# [프로필 조회] (기존과 동일)
@profile_router.get("/profile/{user_db_id}")
def get_user_profile(user_db_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_db_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    
    return {
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role
    }


# ===== [수정됨] 3. 최종 프로필 수정 API =====
@profile_router.put("/profile/{user_db_id}")
def update_user_profile(
    user_db_id: int,
    request: Request,
    email: str = Form(None),
    new_password: str = Form(None),
    current_password: str = Form(...),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_db_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    
    # 1. 현재 비밀번호 검증 (필수)
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="현재 비밀번호가 틀렸습니다.")
    
    # 2. 이메일 수정 (인증 여부 확인 추가, 중복 확인 제거)
    if email:
        record = profile_email_verifications.get(email)
        if not record or not record.get("is_verified"):
            raise HTTPException(status_code=400, detail="새 이메일 인증을 먼저 진행해주세요.")
        
        user.email = email
    
    # 3. 비밀번호 수정
    if new_password:
        if len(new_password) < 6:
            raise HTTPException(status_code=400, detail="비밀번호는 6자 이상이어야 합니다.")
        user.password_hash = hash_password(new_password)
    
    db.commit()
    
    # 4. 로그 기록 및 임시 저장소 정리
    changes = []
    if email: 
        changes.append("email changed")
        del profile_email_verifications[email]  # 변경 성공 시 메모리에서 삭제
        
    if new_password: 
        changes.append("password changed")
    
    log_admin_activity(
        db=db, admin_user_id=user_db_id, action="PROFILE_UPDATED",
        target_type="USER", target_id=user_db_id,
        details=json.dumps({"changes": changes}), ip_address=request.client.host
    )
    
    return {
        "message": "프로필이 성공적으로 수정되었습니다.",
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email
    }

# [회원 탈퇴]
@profile_router.delete("/withdraw/{username}")
def withdraw_user(username: str, request: Request, db: Session = Depends(get_db)):
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user: raise HTTPException(status_code=404, detail="탈퇴할 사용자를 찾을 수 없습니다.")
        if user.role == 'admin': raise HTTPException(status_code=400, detail="관리자 계정은 이 경로로 탈퇴할 수 없습니다.")

        user_id = user.id
        deleted_sessions = db.query(UserSession).filter(UserSession.user_id == user_id).delete(synchronize_session=False)
        deleted_logs = db.query(AdminActivityLog).filter(AdminActivityLog.admin_user_id == user_id).delete(synchronize_session=False)
        deleted_docs = db.query(PdfDocument).filter(PdfDocument.user_id == user_id).delete(synchronize_session=False)

        db.delete(user)
        db.commit()

        return {
            "message": "회원 탈퇴가 완료되었습니다.", "withdrawn_username": username,
            "cleanup": {"sessions": deleted_sessions, "activity_logs": deleted_logs, "documents": deleted_docs}
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"회원 탈퇴 실패: {str(e)}")