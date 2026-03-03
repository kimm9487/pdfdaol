from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session
from database import get_db, User
from routers.auth_utils import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["Profile"])

@router.get("/profile/{user_db_id}")
def get_user_profile(user_db_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_db_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    return {"username": user.username, "full_name": user.full_name, "email": user.email, "role": user.role}

@router.put("/profile/{user_db_id}")
def update_user_profile(
    user_db_id: int,
    email: str = Form(None),
    new_password: str = Form(None),
    current_password: str = Form(...),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_db_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="현재 비밀번호가 틀렸습니다.")
    
    if email:
        existing_email = db.query(User).filter(User.email == email, User.id != user_db_id).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="이미 사용 중인 이메일입니다.")
        user.email = email
    
    if new_password:
        if len(new_password) < 6:
            raise HTTPException(status_code=400, detail="비밀번호는 6자 이상이어야 합니다.")
        user.password_hash = hash_password(new_password)
    
    db.commit()
    return {
        "message": "프로필이 성공적으로 수정되었습니다.",
        "username": user.username, "full_name": user.full_name, "email": user.email
    }