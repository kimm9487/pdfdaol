from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session
from database import get_db, User
from routers.auth_utils import hash_password

router = APIRouter(prefix="/auth", tags=["Register"])

@router.post("/register")
def register(
    user_id: str = Form(...), 
    user_pw: str = Form(...), 
    user_name: str = Form(...), 
    user_email: str = Form(None),
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(User.username == user_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 사용 중인 아이디입니다.")
    
    new_user = User(
        username=user_id, 
        password_hash=hash_password(user_pw), 
        full_name=user_name, 
        email=user_email
    )
    db.add(new_user)
    db.commit()
    return {"message": "회원가입이 완료되었습니다."}

@router.get("/check-id")
def check_id(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if user:
        return {"available": False, "message": "이미 사용 중인 아이디입니다."}
    return {"available": True, "message": "사용 가능한 아이디입니다."}