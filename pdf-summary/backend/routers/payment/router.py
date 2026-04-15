from fastapi import APIRouter
from .kakao import kakao_router

router = APIRouter(prefix="/api/payments", tags=["Payments"])

router.include_router(kakao_router)
