from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Form
from sqlalchemy.orm import Session
from database import get_db, User
import random
import smtplib
from email.mime.text import MIMEText

router = APIRouter(prefix="/auth", tags=["Find Account"])

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

@router.post("/send-code")
async def send_code(email: str = Form(...), background_tasks: BackgroundTasks = None, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="등록되지 않은 이메일입니다.")

    code = str(random.randint(100000, 999999))
    verification_storage[email] = code
    if background_tasks:
        background_tasks.add_task(send_email, email, code)
    return {"message": "인증번호 발송 완료"}

@router.post("/verify-find-id")
async def verify_find_id(email: str = Form(...), code: str = Form(...), db: Session = Depends(get_db)):
    if verification_storage.get(email) != code:
        raise HTTPException(status_code=400, detail="번호가 틀렸습니다.")
    
    user = db.query(User).filter(User.email == email).first()
    return {"username": user.username}