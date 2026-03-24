import json
import time

from . import websocket_runtime as runtime


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
            online_list = [
                {"userId": uid, "name": name}
                for uid, name in users_hash.items()
            ]
            runtime.log("DEBUG", f"Redis에서 온라인 사용자 조회: {len(online_list)}명")
        except Exception as exc:
            runtime.log("WARNING", f"Redis hgetall 오류 → 로컬 메모리 사용: {exc}")
            online_list = [
                {"userId": uid, "name": name}
                for uid, name in runtime.online_users_local.items()
            ]
    else:
        online_list = [
            {"userId": uid, "name": name}
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
async def update_redis_online(user_id: str, name: str = "", action: str = "add"):
    if action == "add" and name:
        runtime.online_users_local[user_id] = name
        runtime.log("DEBUG", f"Local online add: {user_id} ({len(runtime.online_users_local)}명)")
    elif action == "remove":
        runtime.online_users_local.pop(user_id, None)
        runtime.log("DEBUG", f"Local online remove: {user_id} ({len(runtime.online_users_local)}명)")

    if not runtime.redis_client:
        return

    try:
        pipe = runtime.redis_client.pipeline()
        if action == "add" and name:
            pipe.hset(runtime.ONLINE_USERS_KEY, user_id, name)
        elif action == "remove":
            pipe.hdel(runtime.ONLINE_USERS_KEY, user_id)

        pipe.expire(runtime.ONLINE_USERS_KEY, 3600)
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
        return [json.loads(message) for message in raw_msgs if message]
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