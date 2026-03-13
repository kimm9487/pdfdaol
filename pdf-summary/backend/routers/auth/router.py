from fastapi import APIRouter

# 위에서 만든 작은 라우터들을 가져옵니다.
from .register import register_router
from .login import login_router
from .profile import profile_router
from .find_account import find_account_router
# prefix="/auth"를 설정해서, 이 안에 포함된 모든 경로 앞에 /auth가 자동으로 붙게 만듭니다.
router = APIRouter(prefix="/auth", tags=["Authentication"])

# 작은 라우터들을 메인 라우터에 합칩니다.
router.include_router(register_router)
router.include_router(login_router)
router.include_router(profile_router)
router.include_router(find_account_router)