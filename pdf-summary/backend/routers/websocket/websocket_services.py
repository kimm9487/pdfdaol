import json
import os
import time
from datetime import datetime

from . import websocket_runtime as runtime


# ==================== DM 보관 정책 (기능별 설정) ====================
# - 30일 롤링 보관: 30일이 지난 DM은 자동 정리
# - DM_RETENTION_DAYS<=0 이면 영구 보관(자동 삭제/TTL 미적용)
# - yml/패키지 변경 없이 Redis 명령만으로 동작
DM_RETENTION_DAYS = int(os.getenv("DM_RETENTION_DAYS", "30"))
DM_RETENTION_SECONDS = DM_RETENTION_DAYS * 24 * 60 * 60
DM_LOCAL_MAX_HISTORY = 1000


def build_dm_room_id(user_a: str, user_b: str) -> str:
    users = [str(user_a), str(user_b)]

    def sort_key(value: str):
        return (not value.isdigit(), int(value) if value.isdigit() else value)

    users.sort(key=sort_key)
    return f"dm:{users[0]}:{users[1]}"


def dm_history_key(room_id: str) -> str:
    # [신규] ZSET 저장 키
    # score: unix timestamp
    # member: serialized message(json)
    return f"chat:{room_id}:history:zset"


def dm_legacy_history_key(room_id: str) -> str:
    # [레거시] 기존 LIST 저장 키
    return f"chat:{room_id}:history"


def dm_message_score(message: dict) -> float:
    # 메시지 timestamp 기반 점수 계산 (UTC epoch seconds)
    # 파싱 실패 시 현재 시각으로 저장해 누락 방지
    raw_ts = message.get("timestamp")
    if isinstance(raw_ts, str) and raw_ts:
        try:
            return datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).timestamp()
        except Exception:
            pass
    return time.time()


def parse_json_messages(raw_messages, context_label: str):
    """손상된 항목은 건너뛰고 파싱 가능한 메시지만 반환한다."""
    parsed = []
    for raw in raw_messages or []:
        if not raw:
            continue
        try:
            message = json.loads(raw)
            if isinstance(message, dict):
                parsed.append(message)
        except Exception as exc:
            runtime.log("WARNING", f"{context_label} 메시지 파싱 실패(건너뜀): {exc}")
    return parsed


def load_local_dm_messages(room_id: str):
    cutoff_ts = time.time() - DM_RETENTION_SECONDS
    history = runtime.dm_history_local.get(room_id, [])

    filtered = [
        msg for msg in history
        if dm_message_score(msg) >= cutoff_ts
    ]

    # 오래된 데이터 정리 + 과도한 메모리 사용 방지
    if len(filtered) > DM_LOCAL_MAX_HISTORY:
        filtered = filtered[-DM_LOCAL_MAX_HISTORY:]

    runtime.dm_history_local[room_id] = filtered
    return filtered


def persist_local_dm_message(room_id: str, message: dict):
    history = runtime.dm_history_local.get(room_id, [])

    if not any(str(item.get("id")) == str(message.get("id")) for item in history):
        history.append(message)

    runtime.dm_history_local[room_id] = history
    load_local_dm_messages(room_id)


# ==================== 온라인 사용자 브로드캐스트 ====================
async def broadcast_online_users(force=False):
    current_time = time.time() * 1000

    if not force:
        if current_time - runtime._last_broadcast_time < runtime._broadcast_throttle_ms:
            runtime._pending_broadcast = True
            return

    runtime._last_broadcast_time = current_time
    runtime._pending_broadcast = False

    if runtime.redis_client:
        try:
            users_hash = await runtime.redis_client.hgetall(runtime.ONLINE_USERS_KEY)
            roles_hash = await runtime.redis_client.hgetall(runtime.ONLINE_USER_ROLES_KEY)
            online_list = [
                {
                    "userId": uid,
                    "name": name,
                    "role": roles_hash.get(uid, "user"),
                }
                for uid, name in users_hash.items()
            ]
            runtime.log("DEBUG", f"Redis에서 온라인 사용자 조회: {len(online_list)}명")
        except Exception as exc:
            runtime.log("WARNING", f"Redis hgetall 오류 → 로컬 메모리 사용: {exc}")
            online_list = [
                {
                    "userId": uid,
                    "name": name,
                    "role": runtime.online_user_roles_local.get(uid, "user"),
                }
                for uid, name in runtime.online_users_local.items()
            ]
    else:
        online_list = [
            {
                "userId": uid,
                "name": name,
                "role": runtime.online_user_roles_local.get(uid, "user"),
            }
            for uid, name in runtime.online_users_local.items()
        ]

    online_list.sort(key=lambda item: item["name"].lower())

    current_hash = json.dumps(online_list, sort_keys=True)
    if current_hash == runtime._prev_online_users_hash:
        runtime.log("DEBUG", f"온라인 사용자 변경 없음 → 브로드캐스트 스킵 ({len(online_list)}명)")
        return

    runtime._prev_online_users_hash = current_hash
    runtime.log("INFO", f"온라인 사용자 브로드캐스트 → 총 {len(online_list)}명")
    await runtime.sio.emit("onlineUsers", online_list)


# ==================== Redis Pub/Sub ====================
async def redis_online_listener():
    if not runtime.redis_client:
        runtime.log("DEBUG", "Redis 리스너 시작 안 함 (redis_client 없음)")
        return

    try:
        pubsub = runtime.redis_client.pubsub()
        await pubsub.subscribe(runtime.ONLINE_USERS_UPDATE_CHANNEL)
        runtime.log("INFO", f"Pub/Sub 구독 성공: {runtime.ONLINE_USERS_UPDATE_CHANNEL}")

        async for message in pubsub.listen():
            if message.get("type") == "message":
                runtime.log("DEBUG", "online_users 변경 감지 → 스로틀 브로드캐스트 실행")
                await broadcast_online_users()
    except Exception as exc:
        runtime.log("ERROR", f"Redis Pub/Sub 리스너 오류: {exc}")


# ==================== 온라인 사용자 저장 ====================
async def update_redis_online(
    user_id: str,
    name: str = "",
    action: str = "add",
    role: str = "user",
):
    if action == "add" and name:
        runtime.online_users_local[user_id] = name
        runtime.online_user_roles_local[user_id] = role or "user"
        runtime.log("DEBUG", f"Local online add: {user_id} ({len(runtime.online_users_local)}명)")
    elif action == "remove":
        runtime.online_users_local.pop(user_id, None)
        runtime.online_user_roles_local.pop(user_id, None)
        runtime.log("DEBUG", f"Local online remove: {user_id} ({len(runtime.online_users_local)}명)")

    if not runtime.redis_client:
        return

    try:
        pipe = runtime.redis_client.pipeline()
        if action == "add" and name:
            pipe.hset(runtime.ONLINE_USERS_KEY, user_id, name)
            pipe.hset(runtime.ONLINE_USER_ROLES_KEY, user_id, role or "user")
        elif action == "remove":
            pipe.hdel(runtime.ONLINE_USERS_KEY, user_id)
            pipe.hdel(runtime.ONLINE_USER_ROLES_KEY, user_id)

        pipe.expire(runtime.ONLINE_USERS_KEY, 3600)
        pipe.expire(runtime.ONLINE_USER_ROLES_KEY, 3600)
        await pipe.execute()
        await runtime.redis_client.publish(runtime.ONLINE_USERS_UPDATE_CHANNEL, "updated")
        runtime.log("DEBUG", f"Redis online {action}: {user_id}")
    except Exception as exc:
        runtime.log("WARNING", f"Redis 업데이트 실패: {exc}")


# ==================== 메시지 저장/로드 ====================
async def load_past_messages():
    if not runtime.redis_client:
        return []

    try:
        raw_msgs = await runtime.redis_client.lrange(runtime.CHAT_HISTORY_KEY, 0, -1)
        return parse_json_messages(raw_msgs, "공용채팅")
    except Exception as exc:
        runtime.log("WARNING", f"과거 메시지 로드 실패: {exc}")
        return []


async def persist_message(message):
    if not runtime.redis_client:
        return

    try:
        await runtime.redis_client.rpush(runtime.CHAT_HISTORY_KEY, json.dumps(message))
        await runtime.redis_client.ltrim(runtime.CHAT_HISTORY_KEY, -runtime.MAX_HISTORY, -1)
        runtime.log("DEBUG", f"Redis 메시지 저장: {message.get('senderId')} ({message.get('id')})")
    except Exception as exc:
        runtime.log("WARNING", f"메시지 저장 실패: {exc}")


async def load_dm_messages(room_id: str):
    if not runtime.redis_client:
        return load_local_dm_messages(room_id)

    try:
        # [1] 롤링 보관일이 설정된 경우에만 오래된 데이터 정리
        zset_key = dm_history_key(room_id)
        if DM_RETENTION_DAYS > 0:
            cutoff_ts = time.time() - DM_RETENTION_SECONDS
            await runtime.redis_client.zremrangebyscore(zset_key, "-inf", cutoff_ts)
        else:
            cutoff_ts = "-inf"

        # [2] 보관 정책에 맞는 범위로 시간순 조회
        raw_msgs = await runtime.redis_client.zrangebyscore(zset_key, cutoff_ts, "+inf")
        if raw_msgs:
            parsed = parse_json_messages(raw_msgs, f"DM({room_id})")
            parsed.sort(key=lambda msg: dm_message_score(msg))
            return parsed

        # [3] 레거시 LIST 데이터가 남아 있으면 1회성 마이그레이션
        legacy_key = dm_legacy_history_key(room_id)
        legacy_raw = await runtime.redis_client.lrange(legacy_key, 0, -1)
        if not legacy_raw:
            return []

        migrated_messages = []
        zadd_mapping = {}

        for msg in parse_json_messages(legacy_raw, f"DM legacy({room_id})"):
            score = dm_message_score(msg)
            if DM_RETENTION_DAYS <= 0 or score >= float(cutoff_ts):
                migrated_messages.append(msg)
                zadd_mapping[json.dumps(msg)] = score

        if zadd_mapping:
            await runtime.redis_client.zadd(zset_key, zadd_mapping)

        await runtime.redis_client.delete(legacy_key)

        runtime.log(
            "INFO",
            f"DM 레거시 LIST -> ZSET 마이그레이션 완료: room={room_id}, count={len(migrated_messages)}",
        )
        return migrated_messages
    except Exception as exc:
        runtime.log("WARNING", f"DM 과거 메시지 로드 실패({room_id}): {exc}")
        return load_local_dm_messages(room_id)


async def persist_dm_message(room_id: str, message):
    if not runtime.redis_client:
        persist_local_dm_message(room_id, message)
        return

    try:
        # [1] ZSET 저장 (시간축 기반)
        # [2] 롤링 보관일이 설정된 경우 오래된 데이터 자동 정리
        # [3] 롤링 보관일이 설정된 경우 키 TTL 부여
        key = dm_history_key(room_id)
        score = dm_message_score(message)

        pipe = runtime.redis_client.pipeline()
        pipe.zadd(key, {json.dumps(message): score})
        if DM_RETENTION_DAYS > 0:
            cutoff_ts = time.time() - DM_RETENTION_SECONDS
            pipe.zremrangebyscore(key, "-inf", cutoff_ts)
            pipe.expire(key, DM_RETENTION_SECONDS + 86400)
        else:
            # 영구 보관 모드에서는 만료를 제거해 데이터 유지
            pipe.persist(key)
        await pipe.execute()

        runtime.log(
            "DEBUG",
            f"DM 메시지 저장: room={room_id}, sender={message.get('senderId')} ({message.get('id')})",
        )
    except Exception as exc:
        runtime.log("WARNING", f"DM 메시지 저장 실패({room_id}): {exc}")
        persist_local_dm_message(room_id, message)


async def apply_dm_retention_policy_to_existing_keys():
    """영구 보관 모드일 때 기존 DM ZSET의 TTL을 제거한다."""
    if not runtime.redis_client:
        return
    if DM_RETENTION_DAYS > 0:
        return

    try:
        keys = await runtime.redis_client.keys("chat:dm:*:history:zset")
        if not keys:
            return

        pipe = runtime.redis_client.pipeline()
        for key in keys:
            pipe.persist(key)
        await pipe.execute()

        runtime.log("INFO", f"DM 영구 보관 정책 적용: TTL 제거 {len(keys)}개")
    except Exception as exc:
        runtime.log("WARNING", f"DM 영구 보관 정책 적용 실패: {exc}")