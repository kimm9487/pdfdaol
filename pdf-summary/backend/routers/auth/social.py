import os
import httpx
import json
import uuid
import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from database import get_db, User, UserSession, log_admin_activity, get_user_by_email

# prefix를 /google에서 /social로 통합 변경합니다.
social_router = APIRouter(prefix="/social", tags=["Social Login"])

# 1. 환경 변수 로드
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")

NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")
NAVER_REDIRECT_URI = os.getenv("NAVER_REDIRECT_URI")

KAKAO_CLIENT_ID = os.getenv("KAKAO_CLIENT_ID") # 카카오는 REST API 키 사용
KAKAO_REDIRECT_URI = os.getenv("KAKAO_REDIRECT_URI")

# 2. 공통 로그인 처리 함수 (중복 코드 제거)
def process_social_login(db: Session, request: Request, email: str, full_name: str, provider: str):
    if not email:
        raise HTTPException(status_code=400, detail=f"{provider} 계정에서 이메일 정보를 가져올 수 없습니다.")

    user = get_user_by_email(db, email)
    
    # 사용자가 없으면 새로 생성 창으로 리디렉트
    if not user:
        frontend_signup_url = f"http://localhost:5173/register?email={email}&name={full_name}&provider={provider}"
        return RedirectResponse(url=frontend_signup_url)
    
    # 기존 활성 세션 종료
    db.query(UserSession).filter(UserSession.user_id == user.id, UserSession.is_active == True).update({"is_active": False})
    db.commit()
    
    # 새 세션 생성
    session_token = str(uuid.uuid4())
    ip_address = request.client.host if request else "unknown"
    user_agent = request.headers.get("user-agent", "") if request else ""
    
    new_session = UserSession(
        user_id=user.id,
        session_token=session_token,
        expires_at=datetime.datetime.now() + datetime.timedelta(days=30),
        is_active=True,
        ip_address=ip_address,
        user_agent=user_agent
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    
    log_admin_activity(db, user.id, "USER_LOGIN", "USER", user.id, json.dumps({"provider": provider, "ip_address": ip_address}))

    frontend_redirect_url = (
        f"http://localhost:5173/login?"
        f"session_token={session_token}&"
        f"user_name={user.full_name}&"
        f"user_id={user.username}&"
        f"user_db_id={user.id}"
    )
    return RedirectResponse(url=frontend_redirect_url)

# ==================== GOOGLE ====================
@social_router.get("/google/login")
async def login_google():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google Client ID가 설정되지 않았습니다.")
    auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"response_type=code&client_id={GOOGLE_CLIENT_ID}&"
        f"redirect_uri={GOOGLE_REDIRECT_URI}&scope=openid%20email%20profile"
    )
    return RedirectResponse(url=auth_url)

@social_router.get("/google/callback")
async def google_callback(request: Request, code: str, db: Session = Depends(get_db)):
    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI, "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient() as client:
            token_res = await client.post(token_url, data=token_data)
            token_res.raise_for_status()
            access_token = token_res.json().get("access_token")

            userinfo_res = await client.get("https://www.googleapis.com/oauth2/v2/userinfo", headers={"Authorization": f"Bearer {access_token}"})
            userinfo_res.raise_for_status()
            user_info = userinfo_res.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"Google 인증 실패: {e.response.text}")
    
    return process_social_login(db, request, user_info.get("email"), user_info.get("name"), "google")

# ==================== NAVER ====================
@social_router.get("/naver/login")
async def login_naver():
    if not NAVER_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Naver Client ID가 설정되지 않았습니다.")
    state = str(uuid.uuid4())
    auth_url = (
        f"https://nid.naver.com/oauth2.0/authorize?"
        f"response_type=code&client_id={NAVER_CLIENT_ID}&"
        f"redirect_uri={NAVER_REDIRECT_URI}&state={state}"
    )
    return RedirectResponse(url=auth_url)

@social_router.get("/naver/callback")
async def naver_callback(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    token_url = "https://nid.naver.com/oauth2.0/token"
    token_data = {
        "grant_type": "authorization_code", "client_id": NAVER_CLIENT_ID,
        "client_secret": NAVER_CLIENT_SECRET, "code": code, "state": state
    }
    try:
        async with httpx.AsyncClient() as client:
            token_res = await client.post(token_url, data=token_data)
            token_res.raise_for_status()
            access_token = token_res.json().get("access_token")

            userinfo_res = await client.get("https://openapi.naver.com/v1/nid/me", headers={"Authorization": f"Bearer {access_token}"})
            userinfo_res.raise_for_status()
            user_info = userinfo_res.json().get("response", {})
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"Naver 인증 실패: {e.response.text}")
    
    return process_social_login(db, request, user_info.get("email"), user_info.get("name"), "naver")

# ==================== KAKAO ====================
@social_router.get("/kakao/login")
async def login_kakao():
    if not KAKAO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Kakao Client ID가 설정되지 않았습니다.")
    auth_url = (
        f"https://kauth.kakao.com/oauth/authorize?"
        f"response_type=code&client_id={KAKAO_CLIENT_ID}&"
        f"redirect_uri={KAKAO_REDIRECT_URI}"
    )
    return RedirectResponse(url=auth_url)

@social_router.get("/kakao/callback")
async def kakao_callback(request: Request, code: str, db: Session = Depends(get_db)):
    token_url = "https://kauth.kakao.com/oauth/token"
    
    # 💡 [보완] .env 파일의 공백이나 특수문자로 인한 인증 실패를 방지합니다.
    clean_client_id = KAKAO_CLIENT_ID.strip() if KAKAO_CLIENT_ID else ""
    clean_redirect_uri = KAKAO_REDIRECT_URI.strip() if KAKAO_REDIRECT_URI else ""
    kakao_secret = os.getenv("KAKAO_CLIENT_SECRET")

    token_data = {
        "grant_type": "authorization_code",
        "client_id": clean_client_id,
        "redirect_uri": clean_redirect_uri,
        "code": code,
    }
    
    # Client Secret이 설정되어 있다면 추가로 보냅니다.
    if kakao_secret:
        token_data["client_secret"] = kakao_secret.strip()

    headers = {"Content-type": "application/x-www-form-urlencoded;charset=utf-8"}
    
    try:
        async with httpx.AsyncClient() as client:
            # 1. 액세스 토큰 요청
            token_res = await client.post(token_url, data=token_data, headers=headers)
            token_res.raise_for_status()
            access_token = token_res.json().get("access_token")

            # 2. 사용자 정보 요청
            userinfo_headers = {
                "Authorization": f"Bearer {access_token}", 
                "Content-type": "application/x-www-form-urlencoded;charset=utf-8"
            }
            userinfo_res = await client.get("https://kapi.kakao.com/v2/user/me", headers=userinfo_headers)
            userinfo_res.raise_for_status()
            user_info = userinfo_res.json()
            
            # 3. 데이터 추출 및 이메일 부재 시 대응 로직
            kakao_account = user_info.get("kakao_account", {})
            kakao_id = user_info.get("id") # 카카오 사용자 고유 번호
            email = kakao_account.get("email")
            
            # 💡 [핵심 수정] 이메일 권한이 없어서 None이 들어올 경우, 고유 ID로 이메일을 자동 생성합니다.
            if not email:
                # 사용자가 '선택 동의'에서 이메일을 체크 안 해도 가입 페이지로 넘어갈 수 있게 합니다.
                email = f"kakao_{kakao_id}@kakao.user"
                
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"Kakao 인증 실패: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"인증 처리 중 오류 발생: {str(e)}")
    
    # 닉네임 설정
    full_name = kakao_account.get("profile", {}).get("nickname", "카카오유저")
    
    # 수정된 email과 함께 로그인/회원가입 프로세스 진행
    return process_social_login(db, request, email, full_name, "kakao")