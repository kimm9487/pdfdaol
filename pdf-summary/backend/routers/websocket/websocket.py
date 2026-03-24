# backend/routers/websocket.py
import socketio
import json
import asyncio
import os

from database import get_db, User, UserSession
from datetime import datetime
from redis.asyncio import Redis, from_url as redis_from_url
# Python 3.9버전 redis
from typing import Optional

# ────────────────────────────────────────────────
# 환경 자동 감지 + 동적 Redis 활성화
# ────────────────────────────────────────────────
def detect_redis_config():
    # 명시적 환경변수 우선
    explicit = os.getenv("USE_REDIS", "").lower()
    if explicit in ("true", "1", "yes", "on"):
        return True, os.getenv("REDIS_URL", "redis://redis:6379/0")

    # Docker 내부 DNS 체크 (timeout 없이)
    import socket
    try:
        socket.getaddrinfo("redis", 6379)
        return True, "redis://redis:6379/0"
    except (socket.gaierror, OSError):
        pass

    return False, None

USE_REDIS, REDIS_URL = detect_redis_config()

manager = None
if USE_REDIS and REDIS_URL:
    try:
        from socketio import AsyncRedisManager
        print(f"[WebSocket] Redis 자동 감지 & 연결 시도: {REDIS_URL}")
        manager = AsyncRedisManager(REDIS_URL)
        print("[WebSocket] Redis Adapter 연결 성공")
    except Exception as e:
        print(f"[WebSocket] Redis 연결 실패 → 자동 In-memory 모드로 전환: {str(e)}")
        manager = None
else:
    print("[WebSocket] Redis 비활성화 또는 감지되지 않음 → In-memory 모드")

sio = socketio.AsyncServer(
    client_manager=manager,
    async_mode='asgi',
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    ping_timeout=30,
    ping_interval=10,
)

websocket_app = socketio.ASGIApp(sio)

online_users_by_sid = {}
online_users_by_user = {}

CHAT_HISTORY_KEY = "chat:history"
MAX_HISTORY = 1000

# Redis 클라이언트 초기화 , python 3.9버전 redius 호환
redis_client: Optional[Redis] = None

if USE_REDIS and REDIS_URL:
    try:
        redis_client = redis_from_url(REDIS_URL, decode_responses=True)
        print("[WebSocket] Redis async 클라이언트 연결 성공")
    except Exception as e:
        print(f"[WebSocket] Redis async 클라이언트 연결 실패: {str(e)}")
        redis_client = None

# 온라인 사용자 Redis 키
ONLINE_USERS_KEY = "chat:online_users"
ONLINE_USERS_UPDATE_CHANNEL = "chat:online:update"

# ==================== 수정된 부분 ====================
async def broadcast_online_users():
    """온라인 사용자 목록을 모든 클라이언트에게 브로드캐스트"""
    if redis_client:
        try:
            users_hash = await redis_client.hgetall(ONLINE_USERS_KEY)
            online_list = [
                {"userId": uid, "name": name}
                for uid, name in users_hash.items()
            ]
        except Exception as e:
            print(f"[WebSocket] Redis hgetall 오류: {e} → 로컬 fallback")
            online_list = [
                {"userId": uid, "name": info.get("name", uid)}
                for uid, info in online_users_by_user.items()
            ]
    else:
        online_list = [
            {"userId": uid, "name": info.get("name", uid)}
            for uid, info in online_users_by_user.items()
        ]

    # 보기 좋게 이름순 정렬 (옵션)
    online_list.sort(key=lambda x: x["name"].lower())
    await sio.emit("onlineUsers", online_list)
# ====================================================

async def redis_online_listener():
    if not redis_client:
        print("[WebSocket] Redis 리스너 시작 안 함 (redis_client 없음)")
        return

    try:
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(ONLINE_USERS_UPDATE_CHANNEL)
        print(f"[WebSocket] Pub/Sub 구독 성공: {ONLINE_USERS_UPDATE_CHANNEL}")

        async for message in pubsub.listen():
            if message.get("type") == "message":
                print("[WebSocket] online_users 변경 감지 → 브로드캐스트")
                await broadcast_online_users()
    except Exception as e:
        print(f"[WebSocket] Redis Pub/Sub 리스너 오류: {e}")

# ====================================================
async def update_redis_online(user_id: str, name: str = "", action: str = "add"):
    """Redis에 온라인 사용자 추가/삭제 + TTL 설정 + Pub/Sub 알림"""
    if not redis_client:
        return

    try:
        pipe = redis_client.pipeline()
        if action == "add" and name:
            pipe.hset(ONLINE_USERS_KEY, user_id, name)
        elif action == "remove":
            pipe.hdel(ONLINE_USERS_KEY, user_id)

        # 비정상 종료 대비 TTL 1시간
        pipe.expire(ONLINE_USERS_KEY, 3600)
        await pipe.execute()

        # 다른 서버들에게 변경 브로드캐스트 요청
        await redis_client.publish(ONLINE_USERS_UPDATE_CHANNEL, "updated")

    except Exception as e:
        print(f"[WebSocket] Redis 업데이트 실패: {e}")
# ====================================================


@sio.event
async def connect(sid, environ, auth=None):
    session_token = (auth or {}).get('session_token')
    if not session_token:
        await sio.disconnect(sid)
        return

    db = next(get_db())

    # ==================== 수정된 부분 ====================
    try:
        session_record = db.query(UserSession).filter(
            UserSession.session_token == session_token,
            UserSession.is_active == True
        ).first()

        if not session_record:
            await sio.disconnect(sid)
            return

        user = db.query(User).filter(User.id == session_record.user_id).first()
        if not user:
            await sio.disconnect(sid)
            return

        user_id = user.username
        name = user.full_name or user.username

        # 등록
        online_users_by_sid[sid] = user_id
        online_users_by_user[user_id] = {"sids": set(), "name": name}
        # online_users_by_user[user_id] = {"sid": sid, "name": name}

        # Redis에도 등록
        await update_redis_online(user_id, name, "add")

        print(f"[Socket] 접속 → {user_id} ({name})")

    except Exception as e:
        print(f"[Socket] DB 조회 오류: {e}")
        await sio.disconnect(sid)
        return
    finally:
        db.close()
    # ====================================================

    # 새로 접속한 클라이언트에게만 과거 채팅 기록 전송
    if redis_client:
        try:
            raw_msgs = await redis_client.lrange(CHAT_HISTORY_KEY, 0, -1)
            past_messages = [json.loads(m) for m in raw_msgs if m]
            if past_messages:
                await sio.emit("initMessages", past_messages, to=sid)
                print(f"[Socket] {user_id} 에게 과거 메시지 {len(past_messages)}개 전송")
        except Exception as e:
            print(f"[Redis] 과거 메시지 로드 실패: {e}")

    await broadcast_online_users()   # ← 수정: 기존 inline 코드 → 함수 호출로 변경


@sio.event
async def disconnect(sid):
    user_id = online_users_by_sid.pop(sid, None)
    if user_id:
        online_users_by_user.pop(user_id, None)
        await update_redis_online(user_id, action="remove")   # ← 추가

        print(f"[Socket] 퇴장 → {user_id}")

    # ==================== 수정된 부분 ====================
    await broadcast_online_users()   # ← 기존 inline 코드 삭제하고 함수 호출로 통일
    # ====================================================


@sio.event
async def logout(sid):
    user_id = online_users_by_sid.pop(sid, None)

    if user_id:
        online_users_by_user.pop(user_id, None)

        leave_msg = {
            "senderId": "system",
            "content": f"{user_id}님이 로그아웃했습니다.",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "isSystem": True
        }

        await sio.emit("receiveMessage", leave_msg)
        print(f"[Socket] 로그아웃 처리 완료 → {sid}")

    # ==================== 수정된 부분 ====================
    await broadcast_online_users()   # ← 기존 inline 코드 삭제하고 함수 호출로 통일
    # ====================================================


@sio.event
async def sendMessage(sid, data):
    user_id = online_users_by_sid.get(sid)
    if not user_id:
        return

    user_info = online_users_by_user.get(user_id)
    if not user_info:
        return

    msg = {
        "senderId": user_id,
        "content": data.get("content", "").strip(),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "isSystem": False
    }

    # Redis List에 메시지 저장 (영속성 확보)
    if redis_client:
        try:
            await redis_client.rpush(CHAT_HISTORY_KEY, json.dumps(msg))
            await redis_client.ltrim(CHAT_HISTORY_KEY, -MAX_HISTORY, -1)
            print(f"[Redis] 메시지 저장됨 → {user_id}")
        except Exception as e:
            print(f"[Redis] 메시지 저장 실패: {e}")

    # 모든 클라이언트에 브로드캐스트
    await sio.emit("receiveMessage", msg)


@sio.event
async def startup():
    if redis_client:
        asyncio.create_task(redis_online_listener())
        print("[WebSocket] Redis Pub/Sub 리스너 태스크 시작")
    else:
        print("[WebSocket] Redis 없음 → Pub/Sub 리스너 시작 안 함")    


# 모든 @sio.event 정의 끝난 후, 파일의 가장 마지막 줄에 추가.
print(f"✅ WebSocket 서버 시작 - {'Redis 모드' if manager else 'In-memory 모드'}")