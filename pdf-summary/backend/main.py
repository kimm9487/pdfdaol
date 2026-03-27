
# -*- coding: utf-8 -*-
import os
from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

# database.py에서 설정한 Base, engine, get_db를 가져와 설정을 통일합니다.
from database import Base, engine, get_db
from utils.discord import send_discord_alert

# 분할된 라우터들 임포트
from routers.auth.router import router as auth_router
from routers.admin.router import router as admin_router
from routers.document.router import router as document_router
# [추가] 상단 import
from routers.websocket.websocket import sio

# FastAPI 앱 초기화
app = FastAPI(title="PDF Summary System API", version="1.0.0")
# 도커/로컬 호환을 위한 ASGI 엔트리포인트 별칭
asgi_app = app

# 서버 시작 시 테이블 자동 생성
try:
    Base.metadata.create_all(bind=engine)
    print("✅ 데이터베이스 테이블 자동 생성 완료")
except Exception as e:
    print(f"⚠️ 데이터베이스 생성 중 에러 (테이블이 이미 존재할 수 있음): {e}")

# --- 2. FastAPI 앱 설정 ---
app = FastAPI(title="PDF 요약 시스템 API")


# --- 전역 HTTPException 핸들러 (모든 4xx/5xx 자동 디스코드 알림) ---
@app.exception_handler(HTTPException)
async def http_exception_discord_handler(request: Request, exc: HTTPException):
    level = "error" if exc.status_code >= 500 else "warning"

    # query params 우선, 없으면 form data에서 user_id 추출
    user_id = request.query_params.get("user_id")
    if not user_id:
        try:
            form = await request.form()
            user_id = form.get("user_id")
        except Exception:
            pass
    user_id = str(user_id) if user_id else "알 수 없음"

    await send_discord_alert(
        error_msg=exc.detail,
        user_id=user_id,
        path=request.url.path,
        level=level,
        status_code=exc.status_code
    )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# [중요] CORS 미들웨어는 라우터 등록 "전에" 추가해야 합니다!
# 외부 IP 접속을 허용하기 위해 기본 localhost 목록 + IPv4 패턴을 허용합니다.
cors_origins_env = os.getenv("CORS_ALLOW_ORIGINS", "")
cors_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
if not cors_origins:
    cors_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"^https?://(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 라우터 등록 ---

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(document_router)

# --- 기본 루트 경로 ---
@app.get("/")
def root():
    return {"message": "PDF 요약 시스템 API 서버 실행 중"}


if __name__ == "__main__":
    import uvicorn
    reload_enabled = os.getenv("UVICORN_RELOAD", "false").lower() == "true"
    workers = int(os.getenv("UVICORN_WORKERS", "1"))

    # reload 모드와 workers>1은 함께 사용할 수 없으므로 안전하게 분기합니다.
    if reload_enabled:
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
    else:
        uvicorn.run("main:app", host="0.0.0.0", port=8000, workers=max(1, workers))