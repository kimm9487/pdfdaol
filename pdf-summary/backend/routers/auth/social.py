import os
import httpx
import json
import uuid
import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from database import get_db, User, UserSession, log_admin_activity, get_user_by_email

social_router = APIRouter(prefix="/google", tags=["Social Login"])

# .env 파일에서 Google 자격 증명 로드
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")

@social_router.get("/login")
async def login_google():
    """
    Google 로그인 페이지로 리디렉션합니다.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google Client ID가 설정되지 않았습니다.")
    
    auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"response_type=code&"
        f"client_id={GOOGLE_CLIENT_ID}&"
        f"redirect_uri={GOOGLE_REDIRECT_URI}&"
        f"scope=openid%20email%20profile"
    )
    return RedirectResponse(url=auth_url)

@social_router.get("/callback")
async def google_callback(request: Request, code: str, db: Session = Depends(get_db)):
    """
    Google 로그인 후 콜백을 처리하고, 사용자를 생성하거나 로그인한 후 세션 토큰을 발급합니다.
    """
    token_url = "https://oauth2.googleapis.com/token"
    token_data = {
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    
    try:
        # 인증 코드를 액세스 토큰으로 교환
        async with httpx.AsyncClient() as client:
            token_response = await client.post(token_url, data=token_data)
            token_response.raise_for_status()
            token_json = token_response.json()
            access_token = token_json.get("access_token")

            # 사용자 정보 가져오기
            userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"
            headers = {"Authorization": f"Bearer {access_token}"}
            userinfo_response = await client.get(userinfo_url, headers=headers)
            userinfo_response.raise_for_status()
            user_info = userinfo_response.json()

    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"Google 인증 실패: {e.response.text}")
    
    email = user_info.get("email")
    full_name = user_info.get("name")
    
    if not email:
        raise HTTPException(status_code=400, detail="Google 계정에서 이메일 정보를 가져올 수 없습니다.")

    # DB에서 사용자 확인
    user = get_user_by_email(db, email)
    
    # 사용자가 없으면 새로 생성
    if not user:
        # 소셜 로그인 사용자는 username을 이메일 앞부분으로 자동 생성
# 구글에서 받은 이메일과 이름을 URL에 담아 프론트엔드 회원가입 창으로 보냅니다.
        frontend_signup_url = f"http://localhost:5173/register?email={email}&name={full_name}&provider=google"
        return RedirectResponse(url=frontend_signup_url)
    
    # --- 세션 생성 (login.py 로직과 동일) ---
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
    
    # 로그인 로그 기록
    log_admin_activity(db, user.id, "USER_LOGIN", "USER", user.id, json.dumps({"provider": "google", "ip_address": ip_address}))

    # TODO: 성공 후 프론트엔드의 특정 페이지로 리디렉션하면서 토큰을 전달해야 함
    # 예: return RedirectResponse(url=f"http://frontend.url/login/success?token={session_token}")
    frontend_redirect_url = (
        f"http://localhost:5173/login?"  # 프론트엔드 주소에 맞게 포트(5173 등) 확인 필요
        f"session_token={session_token}&"
        f"user_name={user.full_name}&"
        f"user_id={user.username}&"
        f"user_db_id={user.id}"
    )
    return RedirectResponse(url=frontend_redirect_url)