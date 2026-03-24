import asyncio
import uuid
from datetime import datetime

from database import User, UserSession, get_db

from . import websocket_runtime as runtime
from .websocket_services import (
    broadcast_online_users,
    load_past_messages,
    persist_message,
    redis_online_listener,
    update_redis_online,
)


# Redis Pub/Sub 리스너는 프로세스당 1회만 시작
_listener_started = False


def ensure_redis_listener_started():
    global _listener_started
    if runtime.redis_client and not _listener_started:
        asyncio.create_task(redis_online_listener())
        _listener_started = True
        runtime.log("INFO", "Redis Pub/Sub 리스너 태스크 시작")


# ==================== 연결 이벤트 ====================
@runtime.sio.event
async def connect(sid, environ, auth=None):
    ensure_redis_listener_started()

    session_token = (auth or {}).get("session_token")
    if not session_token:
        await runtime.sio.disconnect(sid)
        return

    db = next(get_db())
    try:
        session_record = db.query(UserSession).filter(
            UserSession.session_token == session_token,
            UserSession.is_active == True,
        ).first()

        if not session_record:
            runtime.log("WARNING", f"세션 없음/비활성 → 연결 거부 ({session_token[:8]}...)")
            await runtime.sio.disconnect(sid)
            return

        user = db.query(User).filter(User.id == session_record.user_id).first()
        if not user:
            runtime.log("WARNING", f"유저 없음 → 연결 거부 (user_id={session_record.user_id})")
            await runtime.sio.disconnect(sid)
            return

        user_id = str(user.id)
        name = user.username

        runtime.sid_to_user[sid] = user_id
        await update_redis_online(user_id, name, "add")
        runtime.log("INFO", f"접속 → {user_id} ({name})")
    except Exception as exc:
        runtime.log("ERROR", f"DB 조회 오류: {exc}")
        await runtime.sio.disconnect(sid)
        return
    finally:
        db.close()

    past_messages = await load_past_messages()
    if past_messages:
        await runtime.sio.emit("initMessages", past_messages, to=sid)
        runtime.log("DEBUG", f"{user_id} 에게 과거 메시지 {len(past_messages)}개 전송")

    await broadcast_online_users(force=True)


@runtime.sio.event
async def disconnect(sid):
    user_id = runtime.sid_to_user.pop(sid, None)
    if user_id:
        await update_redis_online(user_id, action="remove")
        runtime.log("INFO", f"퇴장 → {user_id}")

    await broadcast_online_users(force=True)


@runtime.sio.event
async def logout(sid):
    user_id = runtime.sid_to_user.pop(sid, None)
    if user_id:
        await update_redis_online(user_id, action="remove")

        leave_msg = {
            "id": str(uuid.uuid4()),
            "senderId": "system",
            "content": f"{user_id}님이 로그아웃했습니다.",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "isSystem": True,
        }

        await runtime.sio.emit("receiveMessage", leave_msg)
        runtime.log("INFO", f"로그아웃 처리 완료 → {user_id}")

    await broadcast_online_users(force=True)


# ==================== 메시지 이벤트 ====================
@runtime.sio.event
async def sendMessage(sid, data):
    user_id = runtime.sid_to_user.get(sid)
    content = data.get("content", "").strip()

    if not user_id or not content:
        runtime.log("WARNING", "메시지 누락 또는 인증되지 않은 세션")
        return

    sender_name = runtime.online_users_local.get(user_id, str(user_id))
    msg = {
        "id": str(uuid.uuid4()),
        "senderId": str(user_id),
        "senderName": sender_name,
        "content": content,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "isSystem": False,
    }

    await persist_message(msg)
    await runtime.sio.emit("receiveMessage", msg)


@runtime.sio.event
async def typing(sid, data):
    """입력 중 상태를 다른 사용자에게 중계한다."""
    user_id = runtime.sid_to_user.get(sid)
    if not user_id:
        return

    is_typing = bool(data.get("isTyping", False))
    user_name = runtime.online_users_local.get(user_id, user_id)

    payload = {
        "userId": str(user_id),
        "name": user_name,
        "isTyping": is_typing,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    await runtime.sio.emit("typing", payload, skip_sid=sid)


# ==================== 서버 시작 이벤트 ====================
@runtime.sio.event
async def startup():
    ensure_redis_listener_started()
    if not runtime.redis_client:
        runtime.log("DEBUG", "Redis 없음 → Pub/Sub 리스너 시작 안 함")


sio = runtime.sio
websocket_app = runtime.websocket_app