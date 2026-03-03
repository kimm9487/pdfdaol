import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 분할된 라우터들 임포트
from routers.summary import router as summary_router
from routers.history import router as history_router
from routers.admin import router as admin_router
from routers.login import router as login_router
from routers.register import router as register_router
from routers.find_account import router as find_account_router
from routers.profile import router as profile_router

# FastAPI 앱 초기화
app = FastAPI(title="PDF Summary System API", version="1.0.0")

# --- CORS 설정 ---
# 프론트엔드(React, HTML 등)와의 통신을 허용합니다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173", 
        "http://localhost:3000", 
        "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 라우터 등록 ---

# 1. 문서 요약 관련 (기존 /api/summary 등)
app.include_router(summary_router, prefix="/api", tags=["Summary"])

# 2. 사용자 활동 히스토리
app.include_router(history_router)

# 3. 관리자 전용 기능
app.include_router(admin_router)

# 4. 인증 및 계정 관리 (내부 prefix가 /auth로 설정됨)
app.include_router(login_router)
app.include_router(register_router)
app.include_router(find_account_router)
app.include_router(profile_router)

# --- 기본 루트 경로 ---
@app.get("/")
def root():
    return {
        "status": "online",
        "message": "PDF 요약 시스템 API 서버가 정상 동작 중입니다.",
        "docs": "/docs" # FastAPI 제공 Swagger UI 경로
    }

# 서버 실행 (python main.py 로 실행 시)
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)