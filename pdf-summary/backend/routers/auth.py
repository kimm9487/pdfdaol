import bcrypt
import json
from fastapi import APIRouter, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from database import Base, engine, get_db, User, log_admin_activity

router = APIRouter()

# --- 유틸리티 함수 (비밀번호 암호화) ---
def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

# 현재 사용자 확인 의존성 (간단한 버전)
def get_current_user(user_id: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="사용자가 존재하지 않습니다.")
    return user

# 토큰 기반 인증 (헤더에서 user_id 추출)
def get_current_user_id(user_id: str = Form(...)) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="사용자 ID가 필요합니다.")
    return user_id


# [회원가입]
@router.post("/auth/register")
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
    db.refresh(new_user)
    
    # 회원가입 로그 기록
    log_admin_activity(
        db=db,
        admin_user_id=new_user.id,
        action="USER_REGISTERED",
        target_type="USER",
        target_id=new_user.id,
        details=json.dumps({"username": user_id, "email": user_email})
    )
    
    return {"message": "회원가입이 완료되었습니다."}

# [로그인]
@router.post("/auth/login")
def login(user_id: str = Form(...), user_pw: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if not user or not verify_password(user_pw, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")
    
    # 로그인 로그 기록
    log_admin_activity(
        db=db,
        admin_user_id=user.id,
        action="USER_LOGIN",
        target_type="USER",
        target_id=user.id,
        details=json.dumps({"username": user.username})
    )
    
    return {
        "message": "로그인 성공",
        "user_name": user.full_name,
        "user_id": user.username,
        "user_db_id": user.id  # DB에서 사용할 실제 ID 추가
    }

# [아이디 중복 확인]
@router.get("/auth/check-id")
def check_id(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    
    if user:
        # 아이디가 이미 있을 때
        return {
            "available": False, 
            "message": "이미 사용 중인 아이디입니다."
        }
    
    # 아이디가 사용 가능할 때
    return {
        "available": True, 
        "message": "사용 가능한 아이디입니다."
    }

# ===== [추가] 프로필 조회 API =====
# MyPage에서 로그인된 사용자의 프로필 정보(이메일)를 조회
@router.get("/auth/profile/{user_db_id}")
def get_user_profile(user_db_id: int, db: Session = Depends(get_db)):
    """
    사용자 프로필 정보 조회
    Args:
        user_db_id: 사용자 DB ID
    Returns:
        {'username': str, 'full_name': str, 'email': str, 'role': str}
    """
    user = db.query(User).filter(User.id == user_db_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    
    return {
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role
    }

# ===== [추가] 프로필 수정 API (이메일, 비밀번호) =====
# MyPage에서 사용자가 본인의 이메일과 비밀번호를 수정
@router.put("/auth/profile/{user_db_id}")
def update_user_profile(
    user_db_id: int,
    email: str = Form(None),
    new_password: str = Form(None),
    current_password: str = Form(...),  # 비밀번호 변경 시 현재 비밀번호 확인
    db: Session = Depends(get_db)
):
    """
    사용자 프로필 수정 (이메일, 비밀번호)
    Args:
        user_db_id: 수정할 사용자 DB ID
        email: 새 이메일 (선택사항)
        new_password: 새 비밀번호 (선택사항)
        current_password: 현재 비밀번호 (필수 - 보안 확인)
    """
    user = db.query(User).filter(User.id == user_db_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    
    # 현재 비밀번호 검증
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="현재 비밀번호가 틀렸습니다.")
    
    # 이메일 수정
    if email:
        # 이메일 중복 확인
        existing_email = db.query(User).filter(
            User.email == email,
            User.id != user_db_id
        ).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="이미 사용 중인 이메일입니다.")
        user.email = email
    
    # 비밀번호 수정
    if new_password:
        if len(new_password) < 6:
            raise HTTPException(status_code=400, detail="비밀번호는 6자 이상이어야 합니다.")
        user.password_hash = hash_password(new_password)
    
    db.commit()
    
    # 프로필 수정 로그 기록
    changes = []
    if email:
        changes.append("email changed")
    if new_password:
        changes.append("password changed")
    
    log_admin_activity(
        db=db,
        admin_user_id=user_db_id,
        action="PROFILE_UPDATED",
        target_type="USER",
        target_id=user_db_id,
        details=json.dumps({"changes": changes})
    )
    
    return {
        "message": "프로필이 성공적으로 수정되었습니다.",
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email
    }
