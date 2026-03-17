import json
import random
import datetime
from fastapi import APIRouter, Form, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.orm import Session
from database import get_db, User, log_admin_activity
from utils.auth_utils import hash_password
from utils.email_utils import send_email  # 👈 공용 메일 함수 가져오기

register_router = APIRouter()

# 회원가입 이메일 인증 임시 저장소
# 구조: {"user@email.com": {"code": "123456", "expires_at": datetime, "is_verified": False}}
signup_verifications = {}


# [1. 회원가입 이메일 인증번호 발송]
@register_router.post("/send-signup-code")
def send_signup_code(
    email: str = Form(...), 
    background_tasks: BackgroundTasks = None, 
    db: Session = Depends(get_db)
):
    # 이미 가입된 이메일인지 먼저 확인
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="이미 가입된 이메일입니다.")
    
    # 6자리 코드 및 5분 뒤 만료시간 생성 ⏰
    code = str(random.randint(100000, 999999))
    expires_at = datetime.datetime.now() + datetime.timedelta(minutes=5)
    
    # 저장소에 기록
    signup_verifications[email] = {
        "code": code,
        "expires_at": expires_at,
        "is_verified": False
    }
    
    # 메일 발송
    if background_tasks:
        background_tasks.add_task(send_email, email, code)
    else:
        send_email(email, code)
        
    return {"message": "인증번호가 발송되었습니다. 5분 안에 입력해주세요."}


# [2. 인증번호 확인 (5분 타이머 체크)]
@register_router.post("/verify-signup-code")
def verify_signup_code(email: str = Form(...), code: str = Form(...)):
    record = signup_verifications.get(email)
    
    # 1. 인증 요청을 한 적이 없는 경우
    if not record:
        raise HTTPException(status_code=400, detail="인증 요청 내역이 없습니다. 이메일을 다시 확인해주세요.")
        
    # 2. 5분이 지난 경우 ⏳
    if datetime.datetime.now() > record["expires_at"]:
        raise HTTPException(status_code=400, detail="인증 시간이 만료되었습니다. 인증번호를 다시 요청해주세요.")
        
    # 3. 코드가 틀린 경우
    if record["code"] != code:
        raise HTTPException(status_code=400, detail="인증번호가 일치하지 않습니다.")
        
    # 통과하면 인증 완료 처리! ✅
    record["is_verified"] = True
    return {"message": "이메일 인증이 완료되었습니다."}


# [3. 최종 회원가입 (수정됨)]
@register_router.post("/register")
def register(
    request: Request,
    user_id: str = Form(...), 
    user_pw: str = Form(...), 
    user_name: str = Form(...), 
    user_email: str = Form(...),
    provider: str = Form("local"),  # 소셜 로그인 제공자 (예: "google", "kakao", "naver")
    db: Session = Depends(get_db)
):
    # 🚨 가장 중요: 이메일 인증을 마친 유저인지 확인
    if provider == "local":  # 일반 회원가입인 경우에만 이메일 인증 체크
        record = signup_verifications.get(user_email)
        if not record or not record.get("is_verified"):
            raise HTTPException(status_code=400, detail="이메일 인증을 먼저 진행해주세요.")

    existing = db.query(User).filter(User.username == user_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 사용 중인 아이디입니다.")
    
    new_user = User(
        username=user_id, 
        password_hash=hash_password(user_pw), 
        full_name=user_name, 
        email=user_email,
        provider=provider  # 소셜 로그인 제공자 정보 저장
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # 가입 성공 후, 임시 저장소에서 기록 삭제 (메모리 정리)
    if provider == "local" and user_email in signup_verifications:
        del signup_verifications[user_email]
    
    log_admin_activity(
        db=db, admin_user_id=new_user.id, action="USER_REGISTERED",
        target_type="USER", target_id=new_user.id,
        details=json.dumps({"username": user_id, "email": user_email, "provider": provider}),
        ip_address=request.client.host
    )
    
    return {"message": "회원가입이 완료되었습니다."}

# [아이디 중복 확인] (기존과 동일)
@register_router.get("/check-id")
def check_id(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if user: return {"available": False, "message": "이미 사용 중인 아이디입니다."}
    return {"available": True, "message": "사용 가능한 아이디입니다."}