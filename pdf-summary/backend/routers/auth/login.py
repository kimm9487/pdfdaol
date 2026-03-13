import json
import uuid
import datetime
from fastapi import APIRouter, Form, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db, User, UserSession, log_admin_activity
from utils.auth_utils import verify_password  # 분리한 유틸 함수 가져오기

login_router = APIRouter()

# [로그인]
@login_router.post("/login")
def login(request: Request, user_id: str = Form(...), user_pw: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if not user or not verify_password(user_pw, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")
    
    # 동시 로그인 제한: 기존 활성 세션 종료
    existing_sessions = db.query(UserSession).filter(
        UserSession.user_id == user.id,
        UserSession.is_active == True
    ).all()
    
    for session in existing_sessions:
        session.is_active = False
    db.commit()
    
    # 새 세션 생성
    session_token = str(uuid.uuid4())
    ip_address = request.client.host if request else "unknown"
    user_agent = request.headers.get("user-agent", "") if request else ""
    
    new_session = UserSession(
        user_id=user.id,
        session_token=session_token,
        created_at=datetime.datetime.now(),
        expires_at=datetime.datetime.now() + datetime.timedelta(days=30),  # 30일 만료
        is_active=True,
        ip_address=ip_address,
        user_agent=user_agent
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    
    # 로그인 로그 기록
    log_admin_activity(
        db=db,
        admin_user_id=user.id,
        action="USER_LOGIN",
        target_type="USER",
        target_id=user.id,
        details=json.dumps({"username": user.username, "ip_address": ip_address}),
        ip_address=ip_address
    )
    
    return {
        "message": "로그인 성공",
        "user_name": user.full_name,
        "user_id": user.username,
        "user_db_id": user.id,
        "session_token": session_token
    }