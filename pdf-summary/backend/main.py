# -*- coding: utf-8 -*-
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

# database.py에서 설정한 Base, engine, get_db를 가져와 설정을 통일합니다.
from database import Base, engine, get_db

# 분할된 라우터들 임포트
from routers.auth import router as auth_router
from routers.admin import router as admin_router
from routers.history import router as history_router
from routers.summary import router as summary_router
from routers.find_account import router as find_account_router
from routers.find_account import router as find_account_router

# --- 1. DB 모델 정의 ---
# User 모델은 database.py에서 가져옴
# SummaryHistory 대신 database.py의 PdfDocument를 사용

# 서버 시작 시 테이블 자동 생성
try:
    Base.metadata.create_all(bind=engine)
    print("✅ 데이터베이스 테이블 자동 생성 완료")
except Exception as e:
    print(f"⚠️ 데이터베이스 생성 중 에러 (테이블이 이미 존재할 수 있음): {e}")

# --- 2. FastAPI 앱 설정 ---
app = FastAPI(title="PDF 요약 시스템 API")

# [중요] CORS 미들웨어는 라우터 등록 "전에" 추가해야 합니다!
# React 개발 서버(5173, 5174)와 frontend_old(5500)와의 통신을 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:3000","http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 라우터 등록 ---
# 1. 인증 및 계정 관리 (회원가입, 로그인, 프로필)
app.include_router(auth_router)

# 2. 계정 찾기 (이메일 인증)
app.include_router(find_account_router)

# 3. 문서 요약 관련
app.include_router(summary_router, prefix="/api", tags=["summary"])

# 4. 마이페이지 히스토리
app.include_router(history_router)

# 5. 관리자 전용 기능
app.include_router(admin_router)





# --- 기본 루트 경로 ---
@app.get("/")
def root():
    return {"message": "PDF 요약 시스템 API 서버 실행 중"}


if __name__ == "__main__":
    import uvicorn
    # app 대신 "main:app"을 넣고 reload=True 추가
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
