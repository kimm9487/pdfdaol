from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session
from database import get_db, User
from routers.auth_utils import verify_password

router = APIRouter(prefix="/auth", tags=["Login"])

@router.post("/login")
def login(user_id: str = Form(...), user_pw: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if not user or not verify_password(user_pw, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")
    
    return {
        "id": user.id,  # 이 값이 프론트의 userDbId가 됩니다
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "access_token": "...",
        "token_type": "bearer"
    }