import datetime
import os
import uuid

import requests
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from database import PaymentTransaction, PdfDocument, User, get_db

kakao_router = APIRouter(prefix="/kakao", tags=["KakaoPay"])

def _get_kakao_api_config() -> dict:
    secret_key = (os.getenv("KAKAO_PAY_SECRET_KEY") or "").strip()
    admin_key = (os.getenv("KAKAO_ADMIN_KEY") or "").strip()

    if secret_key:
        auth_value = secret_key if secret_key.startswith("SECRET_KEY ") else f"SECRET_KEY {secret_key}"
        return {
            "ready_url": "https://open-api.kakaopay.com/online/v1/payment/ready",
            "approve_url": "https://open-api.kakaopay.com/online/v1/payment/approve",
            "authorization": auth_value,
            "content_type": "application/json",
            "request_mode": "json",
            "auth_mode": "secret_key",
        }

    if admin_key:
        auth_value = admin_key if admin_key.startswith("KakaoAK ") else f"KakaoAK {admin_key}"
        return {
            "ready_url": "https://kapi.kakao.com/v1/payment/ready",
            "approve_url": "https://kapi.kakao.com/v1/payment/approve",
            "authorization": auth_value,
            "content_type": "application/x-www-form-urlencoded;charset=utf-8",
            "request_mode": "form",
            "auth_mode": "admin_key",
        }

    raise HTTPException(
        status_code=500,
        detail="카카오페이 키가 설정되지 않았습니다. KAKAO_PAY_SECRET_KEY 또는 KAKAO_ADMIN_KEY를 확인하세요.",
    )


def _calc_amount(document: PdfDocument) -> int:
    # 기본 정책: 공개+중요 문서는 건당 1000원 결제
    return 1000


@kakao_router.post("/ready")
def ready_kakao_payment(
    document_id: int = Body(...),
    user_id: int = Body(...),
    amount: int | None = Body(None),
    db: Session = Depends(get_db),
):
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if not bool(document.is_public) or not bool(document.is_important):
        raise HTTPException(
            status_code=400,
            detail="결제 대상이 아닙니다. 공개+중요 문서만 결제할 수 있습니다.",
        )

    if document.user_id == user_id or user.role == "admin":
        raise HTTPException(
            status_code=400,
            detail="본인 문서(또는 관리자)는 결제 없이 열람할 수 있습니다.",
        )

    already_paid = (
        db.query(PaymentTransaction)
        .filter(
            PaymentTransaction.document_id == document_id,
            PaymentTransaction.user_id == user_id,
            PaymentTransaction.provider == "kakaopay",
            PaymentTransaction.status == "approved",
        )
        .first()
    )
    if already_paid:
        return {
            "message": "이미 결제된 문서입니다.",
            "already_paid": True,
            "partner_order_id": already_paid.partner_order_id,
        }

    partner_order_id = f"DOC-{document_id}-USR-{user_id}-{uuid.uuid4().hex[:8]}"
    partner_user_id = f"user-{user_id}"

    cid = os.getenv("KAKAO_PAY_CID", "TC0ONETIME")
    frontend_base = (os.getenv("FRONTEND_BASE_URL") or "http://localhost:5173").rstrip("/")
    pay_amount = int(amount) if amount is not None else _calc_amount(document)
    api_config = _get_kakao_api_config()

    payload = {
        "cid": cid,
        "partner_order_id": partner_order_id,
        "partner_user_id": partner_user_id,
        "item_name": document.filename[:100],
        "quantity": 1,
        "total_amount": pay_amount,
        "tax_free_amount": 0,
        "approval_url": f"{frontend_base}/payments/kakao/success?order_id={partner_order_id}&user_id={user_id}&document_id={document_id}",
        "cancel_url": f"{frontend_base}/payments/kakao/fail?reason=cancel&order_id={partner_order_id}&document_id={document_id}",
        "fail_url": f"{frontend_base}/payments/kakao/fail?reason=fail&order_id={partner_order_id}&document_id={document_id}",
    }

    headers = {
        "Authorization": api_config["authorization"],
        "Content-Type": api_config["content_type"],
    }

    try:
        if api_config["request_mode"] == "json":
            response = requests.post(
                api_config["ready_url"],
                json=payload,
                headers=headers,
                timeout=15,
            )
        else:
            response = requests.post(
                api_config["ready_url"],
                data=payload,
                headers=headers,
                timeout=15,
            )
        if response.status_code >= 400:
            raise HTTPException(
                status_code=400,
                detail=f"카카오페이 ready 실패({api_config['auth_mode']}): {response.text}",
            )
        ready_data = response.json()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"카카오페이 연결 실패: {str(exc)}") from exc

    transaction = PaymentTransaction(
        document_id=document_id,
        user_id=user_id,
        provider="kakaopay",
        status="pending",
        amount=pay_amount,
        partner_order_id=partner_order_id,
        partner_user_id=partner_user_id,
        tid=ready_data.get("tid"),
        created_at=datetime.datetime.now(),
    )
    db.add(transaction)
    db.commit()

    return {
        "partner_order_id": partner_order_id,
        "next_redirect_pc_url": ready_data.get("next_redirect_pc_url"),
        "next_redirect_mobile_url": ready_data.get("next_redirect_mobile_url"),
        "created_at": ready_data.get("created_at"),
    }


@kakao_router.post("/approve")
def approve_kakao_payment(
    order_id: str = Body(...),
    pg_token: str = Body(...),
    user_id: int = Body(...),
    db: Session = Depends(get_db),
):
    transaction = (
        db.query(PaymentTransaction)
        .filter(
            PaymentTransaction.partner_order_id == order_id,
            PaymentTransaction.user_id == user_id,
            PaymentTransaction.provider == "kakaopay",
        )
        .order_by(PaymentTransaction.created_at.desc())
        .first()
    )

    if not transaction:
        raise HTTPException(status_code=404, detail="결제 요청 정보를 찾을 수 없습니다.")

    if transaction.status == "approved":
        return {
            "message": "이미 승인된 결제입니다.",
            "document_id": transaction.document_id,
            "approved": True,
        }

    cid = os.getenv("KAKAO_PAY_CID", "TC0ONETIME")
    api_config = _get_kakao_api_config()
    payload = {
        "cid": cid,
        "tid": transaction.tid,
        "partner_order_id": transaction.partner_order_id,
        "partner_user_id": transaction.partner_user_id,
        "pg_token": pg_token,
    }
    headers = {
        "Authorization": api_config["authorization"],
        "Content-Type": api_config["content_type"],
    }

    try:
        if api_config["request_mode"] == "json":
            response = requests.post(
                api_config["approve_url"],
                json=payload,
                headers=headers,
                timeout=15,
            )
        else:
            response = requests.post(
                api_config["approve_url"],
                data=payload,
                headers=headers,
                timeout=15,
            )
        if response.status_code >= 400:
            transaction.status = "failed"
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"카카오페이 approve 실패({api_config['auth_mode']}): {response.text}",
            )

        approved_data = response.json()
    except requests.RequestException as exc:
        transaction.status = "failed"
        db.commit()
        raise HTTPException(status_code=502, detail=f"카카오페이 승인 연결 실패: {str(exc)}") from exc

    transaction.status = "approved"
    transaction.payment_method_type = approved_data.get("payment_method_type")
    transaction.approved_at = datetime.datetime.now()
    db.commit()

    return {
        "message": "결제가 승인되었습니다.",
        "document_id": transaction.document_id,
        "approved": True,
    }
