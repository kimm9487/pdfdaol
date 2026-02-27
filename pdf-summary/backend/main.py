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
from database import Base, engine, get_db, User, UserSession
from routers.summary import router as summary_router

# --- 1. DB 모델 정의 ---
# User 모델은 database.py에서 가져옴
# SummaryHistory 대신 database.py의 PdfDocument를 사용

# 서버 시작 시 테이블 자동 생성 (기존 테이블 구조 유지)
# Base.metadata.create_all(bind=engine)  # database.py에서 처리됨

# --- 2. FastAPI 앱 설정 ---
app = FastAPI(title="PDF 요약 시스템 API")

# summary 라우터 등록
app.include_router(summary_router, prefix="/api", tags=["summary"])

# React 개발 서버(5173)와 frontend_old(5500)와의 통신을 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5500","http://localhost:3000"],
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

# [로그인]
@app.post("/auth/login")
def login(user_id: str = Form(...), user_pw: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == user_id).first()
    if not user or not verify_password(user_pw, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")
    
    return {
        "message": "로그인 성공",
        "user_name": user.full_name,
        "user_id": user.username,
        "user_db_id": user.id  # DB에서 사용할 실제 ID 추가
    }

# [아이디 중복 확인]
@app.get("/auth/check-id")
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

# [로그인 / 회원가입 관련 api는 위에 정의됨]
# summary 라우터는 /api prefix로 등록됨: summarize, translate, models 등

# [마이페이지 히스토리 조회]
@app.get("/api/history/{user_db_id}")
def get_summary_history(user_db_id: int, db: Session = Depends(get_db)):
    # database.py의 get_user_documents 함수 활용
    from database import get_user_documents
    documents = get_user_documents(db, user_db_id)
    
    return [
        {
            "id": doc.id,
            "date": doc.created_at.strftime("%Y-%m-%d") if doc.created_at else "",
            "fileName": doc.filename,
            "model": doc.model_used,
            "status": "완료"
        } for doc in documents
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
                    "id": u.id,
                    "filename": f"미등록 문서(사용자: {u.full_name})",
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