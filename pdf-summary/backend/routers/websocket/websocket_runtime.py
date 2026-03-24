import os
import socket
import socketio
from typing import Optional
from urllib.parse import urlparse

from redis.asyncio import Redis, from_url as redis_from_url


# ==================== 로그 설정 ====================
LOG_LEVELS = {
    "DEBUG": 10,
    "INFO": 20,
    "WARNING": 30,
    "ERROR": 40,
}


def _is_truthy(value: str) -> bool:
    return value.lower().strip() in ("true", "1", "yes", "on")


WEBSOCKET_LOG_LEVEL = os.getenv("WEBSOCKET_LOG_LEVEL", "INFO").upper().strip()
if WEBSOCKET_LOG_LEVEL not in LOG_LEVELS:
    WEBSOCKET_LOG_LEVEL = "INFO"

SOCKETIO_VERBOSE_LOGS = _is_truthy(os.getenv("SOCKETIO_VERBOSE_LOGS", "false"))


def log(level: str, message: str):
    normalized = level.upper().strip()
    if normalized not in LOG_LEVELS:
        normalized = "INFO"
    if LOG_LEVELS[normalized] >= LOG_LEVELS[WEBSOCKET_LOG_LEVEL]:
        print(f"[WebSocket:{normalized}] {message}")


# ==================== Redis 자동 감지 ====================
def build_redis_candidates():
    candidates = []

    explicit_url = os.getenv("REDIS_URL", "").strip()
    if explicit_url:
        candidates.append(explicit_url)

    redis_host = os.getenv("REDIS_HOST", "").strip()
    redis_port = os.getenv("REDIS_PORT", "6379").strip() or "6379"
    redis_db = os.getenv("REDIS_DB", "0").strip() or "0"
    if redis_host:
        candidates.append(f"redis://{redis_host}:{redis_port}/{redis_db}")

    candidates.extend(
        [
            "redis://redis:6379/0",
            "redis://127.0.0.1:6379/0",
            "redis://localhost:6379/0",
            "redis://host.docker.internal:6379/0",
        ]
    )

    return list(dict.fromkeys(candidates))


def can_reach_redis(url: str, timeout: float = 0.3) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or 6379
    if not host:
        return False

    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def detect_redis_config():
    explicit = os.getenv("USE_REDIS", "").lower().strip()
    if explicit in ("false", "0", "no", "off"):
        log("INFO", "USE_REDIS=false 감지 → Redis 비활성화")
        return False, None

    candidates = build_redis_candidates()
    for candidate in candidates:
        if can_reach_redis(candidate):
            log("INFO", f"Redis 자동 감지 성공 → {candidate}")
            return True, candidate

    log("WARNING", f"사용 가능한 Redis 없음 → 후보 {candidates}")
    return False, None


# ==================== Socket.IO / Redis 런타임 ====================
USE_REDIS, REDIS_URL = detect_redis_config()

manager = None
if USE_REDIS and REDIS_URL:
    try:
        from socketio import AsyncRedisManager

        log("INFO", f"Redis Adapter 연결 시도 → {REDIS_URL}")
        manager = AsyncRedisManager(REDIS_URL)
        log("INFO", "Redis Adapter 연결 성공")
    except Exception as exc:
        log("WARNING", f"Redis Adapter 연결 실패 → In-memory 모드 전환: {exc}")
        manager = None
else:
    log("WARNING", "Redis 비활성화 또는 감지되지 않음 → In-memory 모드")


sio = socketio.AsyncServer(
    client_manager=manager,
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=SOCKETIO_VERBOSE_LOGS,
    engineio_logger=SOCKETIO_VERBOSE_LOGS,
    ping_timeout=30,
    ping_interval=10,
)

websocket_app = socketio.ASGIApp(sio)


# ==================== 공유 상태 ====================
sid_to_user = {}
online_users_local = {}

_last_broadcast_time = 0.0
_pending_broadcast = False
_broadcast_throttle_ms = 1000
_prev_online_users_hash = None

CHAT_HISTORY_KEY = "chat:history"
MAX_HISTORY = 1000
ONLINE_USERS_KEY = "chat:online_users"
ONLINE_USERS_UPDATE_CHANNEL = "chat:online:update"


# ==================== Redis 클라이언트 ====================
redis_client: Optional[Redis] = None
if USE_REDIS and REDIS_URL:
    try:
        redis_client = redis_from_url(REDIS_URL, decode_responses=True)
        log("INFO", "Redis async 클라이언트 연결 성공")
    except Exception as exc:
        log("WARNING", f"Redis async 클라이언트 연결 실패: {exc}")
        redis_client = None


log("INFO", f"서버 시작 - {'Redis 모드' if manager else 'In-memory 모드'}")