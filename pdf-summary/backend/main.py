import os
import bcrypt
from fastapi import FastAPI, Form, Depends, HTTPException, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func

# database.py에서 설정한 Base, engine, get_db를 가져와 설정을 통일합니다.
from database import Base, engine, get_db

# --- 1. DB 모델 정의 ---
# 회원 정보 테이블
class User(Base):
    __tablename__ = "user"  # 아까 CMD에서 확인한 테이블명과 일치시킵니다.
    __table_args__ = {'extend_existing': True}    
    # 만약 DESC user; 했을 때 컬럼명이 user_no가 아니라 id라면 아래를 id로 바꿔주세요.
    user_no = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), unique=True, nullable=False)
    user_pw = Column(String(255), nullable=False)
    user_name = Column(String(50), nullable=False)
    user_email = Column(String(100))

# 요약 히스토리 테이블 (마이페이지용)
class SummaryHistory(Base):
    __tablename__ = "summary_history"
    __table_args__ = {'extend_existing': True}
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(50), ForeignKey("user.user_id"), nullable=False)
    file_name = Column(String(255), nullable=False)
    model_used = Column(String(50))
    summary_text = Column(String(2000))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# 서버 시작 시 테이블 자동 생성
Base.metadata.create_all(bind=engine)

# --- 2. FastAPI 앱 설정 ---
app = FastAPI(title="PDF 요약 시스템 API")

# React 개발 서버(5173)와의 통신을 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 3. 유틸리티 함수 (비밀번호 암호화) ---
def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

# --- 4. API 엔드포인트 ---

# [회원가입]
@app.post("/auth/register")
def register(
    user_id: str = Form(...), 
    user_pw: str = Form(...), 
    user_name: str = Form(...), 
    user_email: str = Form(None),
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(User.user_id == user_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 사용 중인 아이디입니다.")
    
    new_user = User(
        user_id=user_id, 
        user_pw=hash_password(user_pw), 
        user_name=user_name, 
        user_email=user_email
    )
    db.add(new_user)
    db.commit()
    return {"message": "회원가입이 완료되었습니다."}

# [로그인]
@app.post("/auth/login")
def login(user_id: str = Form(...), user_pw: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user or not verify_password(user_pw, user.user_pw):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")
    
    return {
        "message": "로그인 성공",
        "user_name": user.user_name,
        "user_id": user.user_id
    }

# [아이디 중복 확인]
@app.get("/auth/check-id")
def check_id(user_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.user_id == user_id).first()
    
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

# [AI 모델 목록 조회]
@app.get("/api/models")
def get_models():
    return {"models": ["gemma3:latest", "llama3:latest"]}

# [마이페이지 히스토리 조회]
@app.get("/api/history/{user_id}")
def get_summary_history(user_id: str, db: Session = Depends(get_db)):
    history = db.query(SummaryHistory).filter(SummaryHistory.user_id == user_id)\
                .order_by(SummaryHistory.created_at.desc()).all()
    
    return [
        {
            "id": h.id,
            "date": h.created_at.strftime("%Y-%m-%d"),
            "fileName": h.file_name,
            "model": h.model_used,
            "status": "완료"
        } for h in history
    ]

# --- 관리자(Admin) 전용 데이터 API ---
# 이 API들은 리액트 프론트엔드에서 데이터를 요청할 때 사용됩니다.

from sqlalchemy import text # 상단에 이 import가 있는지 확인하세요!

@app.get("/api/admin/documents")
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

# [루트 경로 확인]
@app.get("/")
def root():
    return {"message": "PDF 요약 시스템 API 서버 실행 중"}




if __name__ == "__main__":
    import uvicorn
    # app 대신 "main:app"을 넣고 reload=True 추가
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)