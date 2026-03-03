from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Form
from sqlalchemy.orm import Session
from database import get_db, User
from routers.auth_utils import hash_password  # 비밀번호 암호화를 위해 가져옴
import random
import smtplib
from email.mime.text import MIMEText

router = APIRouter(prefix="/auth", tags=["Find Account"])

# 인증번호 임시 저장소 (이메일: 인증번호)
verification_storage = {}

def send_email(email: str, code: str):
    sender_email = "jayyoon.lee98@gmail.com" 
    sender_password = "zbmj cwkk sbwb nuqr" 
    
    msg = MIMEText(f"인증번호는 [{code}] 입니다.")
    msg["Subject"] = "[PDF 요약] 본인확인 인증번호"
    msg["From"] = sender_email
    msg["To"] = email

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, email, msg.as_string())
    except Exception as e:
        print(f"이메일 발송 에러: {e}")

# [1. 인증번호 발송] - 아이디/비밀번호 찾기 공통
@router.post("/send-code-find-id")
async def send_code_find_id(
    email: str = Form(...), 
    background_tasks: BackgroundTasks = None, 
    db: Session = Depends(get_db)
):
    # 이메일로만 유저 확인
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="해당 이메일로 가입된 정보가 없습니다.")

    code = str(random.randint(100000, 999999))
    verification_storage[email] = code
    
    if background_tasks:
        background_tasks.add_task(send_email, email, code)
    else:
        send_email(email, code)
    return {"message": "아이디 찾기 인증번호가 발송되었습니다."}


# --- [1-2. 비밀번호 찾기용 인증번호 발송] ---
@router.post("/send-code-reset-pw")
async def send_code_reset_pw(
    user_id: str = Form(...), 
    email: str = Form(...), 
    background_tasks: BackgroundTasks = None, 
    db: Session = Depends(get_db)
):
    # 아이디와 이메일이 모두 일치하는지 확인
    user = db.query(User).filter(User.username == user_id, User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="입력하신 아이디와 이메일 정보가 일치하는 사용자가 없습니다.")

    code = str(random.randint(100000, 999999))
    verification_storage[email] = code
    
    if background_tasks:
        background_tasks.add_task(send_email, email, code)
    else:
        send_email(email, code)
    return {"message": "비밀번호 재설정 인증번호가 발송되었습니다."}

# [2. 아이디 찾기 확인]
@router.post("/verify-find-id")
async def verify_find_id(email: str = Form(...), code: str = Form(...), db: Session = Depends(get_db)):
    if verification_storage.get(email) != code:
        raise HTTPException(status_code=400, detail="번호가 틀렸습니다.")
    
    user = db.query(User).filter(User.email == email).first()
    # 이메일 정보를 함께 넘겨주면 프론트에서 비번 재설정 시 편리합니다.
    return {"username": user.username, "email": user.email}

# [2. 인증번호 확인만 진행] - 비밀번호 재설정 전 단계
@router.post("/verify-code")
async def verify_code(email: str = Form(...), code: str = Form(...)):
    if verification_storage.get(email) != code:
        raise HTTPException(status_code=400, detail="인증번호가 일치하지 않습니다.")
    # 인증 성공 시 (삭제하지 않음, 다음 단계 reset-password에서 검증 후 삭제)
    return {"message": "인증에 성공했습니다."}

# [3. 비밀번호 최종 변경]
@router.post("/reset-password")
async def reset_password(
    email: str = Form(...), 
    new_password: str = Form(...), 
    confirm_password: str = Form(...),
    db: Session = Depends(get_db)
):
    if new_password != confirm_password:
        raise HTTPException(status_code=400, detail="비밀번호가 일치하지 않습니다.")
    
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    
    user.password_hash = hash_password(new_password)
    db.commit()
    
    if email in verification_storage:
        del verification_storage[email] # 최종 변경 후 삭제
    
    return {"message": "비밀번호가 성공적으로 변경되었습니다."}
    
