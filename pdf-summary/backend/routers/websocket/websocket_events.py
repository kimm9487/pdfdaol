import asyncio
import json
import uuid
from datetime import datetime
from typing import Optional

from database import User, UserSession, get_db

from . import websocket_runtime as runtime
from .websocket_services import (
    apply_dm_retention_policy_to_existing_keys,
    build_dm_room_id,
    broadcast_online_users,
    load_dm_messages,
    load_past_messages,
    persist_dm_message,
    persist_message,
    redis_online_listener,
    update_redis_online,
)


# Redis Pub/Sub 리스너는 프로세스당 1회만 시작
_listener_started = False


def resolve_user_name(user_id: str) -> str:
    normalized_id = str(user_id)

    # 1) 실시간 온라인 맵
    online_name = runtime.online_users_local.get(normalized_id)
    if online_name:
        runtime.user_names_cache[normalized_id] = online_name
        return online_name

    # 2) 프로세스 캐시
    cached_name = runtime.user_names_cache.get(normalized_id)
    if cached_name:
        return cached_name

    # 3) DB 조회 fallback
    db = next(get_db())
    try:
        user = db.query(User).filter(User.id == int(normalized_id)).first()
        if user and user.username:
            runtime.user_names_cache[normalized_id] = user.username
            return user.username
    except Exception as exc:
        runtime.log("WARNING", f"사용자명 조회 실패(user_id={normalized_id}): {exc}")
    finally:
        db.close()

    return normalized_id


def resolve_user_role(user_id: str) -> str:
    normalized_id = str(user_id)
    cached_role = str(runtime.online_user_roles_local.get(normalized_id, "")).strip().lower()
    if cached_role:
        return cached_role

    db = next(get_db())
    try:
        user = db.query(User).filter(User.id == int(normalized_id)).first()
        if user:
            role = str(getattr(user, "role", "user") or "user").strip().lower()
            runtime.online_user_roles_local[normalized_id] = role
            return role
    except Exception as exc:
        runtime.log("WARNING", f"사용자 role 조회 실패(user_id={normalized_id}): {exc}")
    finally:
        db.close()

    return "user"


def is_permanent_ban(ban_data: Optional[dict], ttl: Optional[int] = None) -> bool:
    if not isinstance(ban_data, dict):
        return False

    try:
        ban_seconds = int(ban_data.get("banSeconds", 0))
    except (TypeError, ValueError):
        ban_seconds = 0

    return (
        bool(ban_data.get("isPermanent", False))
        or ban_seconds == -1
        or ttl == -1
    )


def dm_thread_set_key(user_id: str) -> str:
    return f"chat:dm:user:{user_id}:threads"


def dm_last_read_hash_key(user_id: str) -> str:
    return f"chat:dm:user:{user_id}:last_read"


async def register_dm_thread_participants(user_a: str, user_b: str):
    normalized_a = str(user_a)
    normalized_b = str(user_b)
    if not normalized_a or not normalized_b or normalized_a == normalized_b:
        return

    runtime.dm_threads_local.setdefault(normalized_a, set()).add(normalized_b)
    runtime.dm_threads_local.setdefault(normalized_b, set()).add(normalized_a)

    if not runtime.redis_client:
        return

    try:
        pipe = runtime.redis_client.pipeline()
        pipe.sadd(dm_thread_set_key(normalized_a), normalized_b)
        pipe.sadd(dm_thread_set_key(normalized_b), normalized_a)
        await pipe.execute()
    except Exception as exc:
        runtime.log("WARNING", f"DM 스레드 참여자 저장 실패: {exc}")


async def get_dm_thread_participants(user_id: str):
    normalized_user_id = str(user_id)
    local_participants = set(runtime.dm_threads_local.get(normalized_user_id, set()))

    if runtime.redis_client:
        try:
            redis_participants = await runtime.redis_client.smembers(dm_thread_set_key(normalized_user_id))
            if redis_participants:
                local_participants.update(str(partner_id) for partner_id in redis_participants if partner_id)
        except Exception as exc:
            runtime.log("WARNING", f"DM 스레드 참여자 조회 실패: {exc}")

    return sorted(local_participants)


async def set_dm_last_read(user_id: str, partner_user_id: str, timestamp: str):
    normalized_user_id = str(user_id)
    normalized_partner_id = str(partner_user_id)
    if not normalized_user_id or not normalized_partner_id:
        return

    runtime.dm_last_read_local.setdefault(normalized_user_id, {})[normalized_partner_id] = timestamp

    if not runtime.redis_client:
        return

    try:
        await runtime.redis_client.hset(
            dm_last_read_hash_key(normalized_user_id),
            normalized_partner_id,
            timestamp,
        )
    except Exception as exc:
        runtime.log("WARNING", f"DM 마지막 읽음 시각 저장 실패: {exc}")


async def get_dm_last_read_map(user_id: str):
    normalized_user_id = str(user_id)
    result = dict(runtime.dm_last_read_local.get(normalized_user_id, {}))

    if runtime.redis_client:
        try:
            redis_map = await runtime.redis_client.hgetall(dm_last_read_hash_key(normalized_user_id))
            if redis_map:
                result.update({str(partner_id): ts for partner_id, ts in redis_map.items() if partner_id and ts})
        except Exception as exc:
            runtime.log("WARNING", f"DM 마지막 읽음 시각 조회 실패: {exc}")

    return result


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
        role = str(getattr(user, "role", "user") or "user")

        # 강퇴된 동일 세션 토큰은 재로그인 전까지 재접속을 막는다.
        kicked_tokens = runtime.kicked_session_tokens_local.get(user_id, set())
        if session_token in kicked_tokens:
            await runtime.sio.emit(
                "kickRejected",
                {
                    "reason": "강제 퇴장되었습니다. 재로그인 후 이용해 주세요.",
                    "byName": "관리자",
                    "ttlSeconds": 0,
                    "banSeconds": 0,
                    "isPermanent": False,
                    "mustRelogin": True,
                },
                to=sid,
            )
            await runtime.sio.disconnect(sid)
            return

        # 채팅 차단(ban) 여부 확인
        if runtime.redis_client:
            ban_key = f"chat:banned:{user_id}"
            try:
                ban_raw = await runtime.redis_client.get(ban_key)
                if ban_raw:
                    try:
                        ban_data = json.loads(ban_raw)
                    except Exception:
                        ban_data = {}
                    ttl = await runtime.redis_client.ttl(ban_key)
                    is_permanent = is_permanent_ban(ban_data, ttl)
                    if not is_permanent and ttl <= 0:
                        await runtime.redis_client.delete(ban_key)
                        ban_raw = None
                    else:
                        await runtime.sio.emit(
                            "kickRejected",
                            {
                                "reason": ban_data.get("reason", "규칙 위반"),
                                "byName": ban_data.get("byName", "관리자"),
                                "ttlSeconds": 0 if is_permanent else max(0, ttl),
                                "banSeconds": -1 if is_permanent else ban_data.get("banSeconds", 0),
                                "isPermanent": is_permanent,
                            },
                            to=sid,
                        )
                        # 영구 정지도 연결은 유지하고, 발신 이벤트에서만 차단해 실시간 해제를 받게 한다.
            except Exception as exc:
                runtime.log("WARNING", f"ban 체크 오류: {exc}")
        else:
            ban_data = runtime.banned_users_local.get(user_id)
            if ban_data:
                if is_permanent_ban(ban_data):
                    await runtime.sio.emit(
                        "kickRejected",
                        {
                            "reason": ban_data.get("reason", "규칙 위반"),
                            "byName": ban_data.get("byName", "관리자"),
                            "ttlSeconds": 0,
                            "banSeconds": -1,
                            "isPermanent": True,
                        },
                        to=sid,
                    )
                    # 영구 정지는 관리자가 해제할 때까지 ban 데이터를 절대 삭제하지 않는다.
                else:
                    now_ts = datetime.utcnow().timestamp()
                    expires_at = float(ban_data.get("expiresAtTs") or 0)
                    ttl = int(max(0, expires_at - now_ts))
                    if ttl > 0:
                        await runtime.sio.emit(
                            "kickRejected",
                            {
                                "reason": ban_data.get("reason", "규칙 위반"),
                                "byName": ban_data.get("byName", "관리자"),
                                "ttlSeconds": ttl,
                                "banSeconds": ban_data.get("banSeconds", ttl),
                                "isPermanent": False,
                            },
                            to=sid,
                        )
                    else:
                        runtime.banned_users_local.pop(user_id, None)

        runtime.sid_to_user[sid] = user_id
        runtime.sid_to_role[sid] = role
        runtime.sid_to_session_token[sid] = session_token
        runtime.user_names_cache[user_id] = name
        await update_redis_online(user_id, name, "add", role)
        runtime.log("INFO", f"접속 → {user_id} ({name}, role={role})")
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
    runtime.sid_to_role.pop(sid, None)
    runtime.sid_to_session_token.pop(sid, None)
    runtime.sid_to_dm_room.pop(sid, None)
    if user_id:
        await update_redis_online(user_id, action="remove")
        runtime.log("INFO", f"퇴장 → {user_id}")

    await broadcast_online_users(force=True)


@runtime.sio.event
async def logout(sid):
    user_id = runtime.sid_to_user.pop(sid, None)
    runtime.sid_to_role.pop(sid, None)
    runtime.sid_to_session_token.pop(sid, None)
    runtime.sid_to_dm_room.pop(sid, None)
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

    # 채팅 금지 상태에서는 수신은 허용하고 발신만 차단한다.
    if runtime.redis_client:
        ban_key = f"chat:banned:{user_id}"
        try:
            ban_raw = await runtime.redis_client.get(ban_key)
            if ban_raw:
                try:
                    ban_data = json.loads(ban_raw)
                except Exception:
                    ban_data = {}
                ttl = await runtime.redis_client.ttl(ban_key)
                is_permanent = is_permanent_ban(ban_data, ttl)
                if not is_permanent and ttl <= 0:
                    await runtime.redis_client.delete(ban_key)
                else:
                    await runtime.sio.emit(
                        "kickRejected",
                        {
                            "reason": ban_data.get("reason", "규칙 위반"),
                            "byName": ban_data.get("byName", "관리자"),
                            "ttlSeconds": 0 if is_permanent else max(0, ttl),
                            "banSeconds": -1 if is_permanent else ban_data.get("banSeconds", 0),
                            "isPermanent": is_permanent,
                        },
                        to=sid,
                    )
                    return
        except Exception as exc:
            runtime.log("WARNING", f"메시지 전송 전 ban 체크 오류: {exc}")
    else:
        ban_data = runtime.banned_users_local.get(str(user_id))
        if ban_data:
            is_permanent = is_permanent_ban(ban_data)
            if is_permanent:
                await runtime.sio.emit(
                    "kickRejected",
                    {
                        "reason": ban_data.get("reason", "규칙 위반"),
                        "byName": ban_data.get("byName", "관리자"),
                        "ttlSeconds": 0,
                        "banSeconds": -1,
                        "isPermanent": True,
                    },
                    to=sid,
                )
                return
            now_ts = datetime.utcnow().timestamp()
            expires_at = float(ban_data.get("expiresAtTs") or 0)
            ttl = int(max(0, expires_at - now_ts))
            if ttl > 0:
                await runtime.sio.emit(
                    "kickRejected",
                    {
                        "reason": ban_data.get("reason", "규칙 위반"),
                        "byName": ban_data.get("byName", "관리자"),
                        "ttlSeconds": ttl,
                        "banSeconds": ban_data.get("banSeconds", ttl),
                        "isPermanent": False,
                    },
                    to=sid,
                )
                return
            runtime.banned_users_local.pop(str(user_id), None)

    sender_name = resolve_user_name(user_id)
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
    user_name = resolve_user_name(user_id)

    payload = {
        "userId": str(user_id),
        "name": user_name,
        "isTyping": is_typing,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    await runtime.sio.emit("typing", payload, skip_sid=sid)


@runtime.sio.on("joinDmRoom")
async def join_dm_room(sid, data):
    user_id = runtime.sid_to_user.get(sid)
    target_user_id = str((data or {}).get("targetUserId", "")).strip()
    if not user_id or not target_user_id:
        return

    room_id = build_dm_room_id(str(user_id), target_user_id)
    prev_room_id = runtime.sid_to_dm_room.get(sid)
    if prev_room_id and prev_room_id != room_id:
        await runtime.sio.leave_room(sid, prev_room_id)

    await runtime.sio.enter_room(sid, room_id)
    runtime.sid_to_dm_room[sid] = room_id

    history = await load_dm_messages(room_id)
    await register_dm_thread_participants(str(user_id), target_user_id)
    await set_dm_last_read(
        str(user_id),
        target_user_id,
        history[-1].get("timestamp") if history else datetime.utcnow().isoformat() + "Z",
    )
    await runtime.sio.emit(
        "dmHistory",
        {
            "roomId": room_id,
            "targetUserId": target_user_id,
            "messages": history,
        },
        to=sid,
    )

    runtime.log("INFO", f"DM 룸 참여: sid={sid}, room={room_id}, history={len(history)}")


@runtime.sio.on("getDmThreadSummaries")
async def get_dm_thread_summaries(sid, data):
    user_id = runtime.sid_to_user.get(sid)
    if not user_id:
        return

    target_user_ids = (data or {}).get("targetUserIds", [])
    client_last_read_by_user = (data or {}).get("lastReadByUser", {}) or {}

    if not isinstance(target_user_ids, list):
        target_user_ids = []
    if not isinstance(client_last_read_by_user, dict):
        client_last_read_by_user = {}

    if not target_user_ids:
        target_user_ids = await get_dm_thread_participants(str(user_id))

    server_last_read_by_user = await get_dm_last_read_map(str(user_id))

    normalized_targets = []
    seen_targets = set()
    for target_user_id in target_user_ids:
        normalized_target = str(target_user_id or "").strip()
        if not normalized_target or normalized_target == str(user_id):
            continue
        if normalized_target in seen_targets:
            continue
        seen_targets.add(normalized_target)
        normalized_targets.append(normalized_target)

    summaries = []
    for target_user_id in normalized_targets:
        room_id = build_dm_room_id(str(user_id), target_user_id)
        history = await load_dm_messages(room_id)
        latest_message = history[-1] if history else None

        raw_last_read = str(
            server_last_read_by_user.get(target_user_id)
            or client_last_read_by_user.get(target_user_id)
            or ""
        ).strip()
        try:
            last_read_ts = (
                datetime.fromisoformat(raw_last_read.replace("Z", "+00:00")).timestamp()
                if raw_last_read else 0
            )
        except Exception:
            last_read_ts = 0

        unread_count = 0
        for message in history:
            message_sender_id = str(message.get("senderId") or "")
            if message_sender_id != target_user_id:
                continue
            try:
                message_ts = datetime.fromisoformat(
                    str(message.get("timestamp") or "").replace("Z", "+00:00")
                ).timestamp()
            except Exception:
                message_ts = 0
            if message_ts > last_read_ts:
                unread_count += 1

        summaries.append(
            {
                "targetUserId": target_user_id,
                "targetUserName": resolve_user_name(target_user_id),
                "roomId": room_id,
                "latestMessage": latest_message,
                "unreadCount": unread_count,
            }
        )

    await runtime.sio.emit(
        "dmThreadSummaries",
        {"summaries": summaries},
        to=sid,
    )


@runtime.sio.on("sendDmMessage")
async def send_dm_message(sid, data):
    user_id = runtime.sid_to_user.get(sid)
    if not user_id:
        return

    # 채팅 금지 상태에서는 DM 발신도 차단한다.
    if runtime.redis_client:
        ban_key = f"chat:banned:{user_id}"
        try:
            ban_raw = await runtime.redis_client.get(ban_key)
            if ban_raw:
                try:
                    ban_data = json.loads(ban_raw)
                except Exception:
                    ban_data = {}
                ttl = await runtime.redis_client.ttl(ban_key)
                is_permanent = is_permanent_ban(ban_data, ttl)
                if not is_permanent and ttl <= 0:
                    await runtime.redis_client.delete(ban_key)
                else:
                    await runtime.sio.emit(
                        "kickRejected",
                        {
                            "reason": ban_data.get("reason", "규칙 위반"),
                            "byName": ban_data.get("byName", "관리자"),
                            "ttlSeconds": 0 if is_permanent else max(0, ttl),
                            "banSeconds": -1 if is_permanent else ban_data.get("banSeconds", 0),
                            "isPermanent": is_permanent,
                        },
                        to=sid,
                    )
                    return
        except Exception as exc:
            runtime.log("WARNING", f"DM 전송 전 ban 체크 오류: {exc}")
    else:
        ban_data = runtime.banned_users_local.get(str(user_id))
        if ban_data:
            is_permanent = is_permanent_ban(ban_data)
            if is_permanent:
                await runtime.sio.emit(
                    "kickRejected",
                    {
                        "reason": ban_data.get("reason", "규칙 위반"),
                        "byName": ban_data.get("byName", "관리자"),
                        "ttlSeconds": 0,
                        "banSeconds": -1,
                        "isPermanent": True,
                    },
                    to=sid,
                )
                return
            now_ts = datetime.utcnow().timestamp()
            expires_at = float(ban_data.get("expiresAtTs") or 0)
            ttl = int(max(0, expires_at - now_ts))
            if ttl > 0:
                await runtime.sio.emit(
                    "kickRejected",
                    {
                        "reason": ban_data.get("reason", "규칙 위반"),
                        "byName": ban_data.get("byName", "관리자"),
                        "ttlSeconds": ttl,
                        "banSeconds": ban_data.get("banSeconds", ttl),
                        "isPermanent": False,
                    },
                    to=sid,
                )
                return
            runtime.banned_users_local.pop(str(user_id), None)

    content = str((data or {}).get("content", "")).strip()
    if not content:
        return

    target_user_id = str((data or {}).get("targetUserId", "")).strip()
    room_id = str((data or {}).get("roomId", "")).strip()
    if not room_id and target_user_id:
        room_id = build_dm_room_id(str(user_id), target_user_id)
    if not room_id:
        return

    room_parts = room_id.split(":")
    if len(room_parts) != 3 or room_parts[0] != "dm":
        runtime.log("WARNING", f"잘못된 DM room_id: {room_id}")
        return

    participant_a, participant_b = room_parts[1], room_parts[2]
    if str(user_id) not in (participant_a, participant_b):
        runtime.log("WARNING", f"DM 권한 없음: user={user_id}, room={room_id}")
        return

    recipient_id = participant_b if str(user_id) == participant_a else participant_a
    sender_name = resolve_user_name(str(user_id))

    prev_room_id = runtime.sid_to_dm_room.get(sid)
    if prev_room_id != room_id:
        if prev_room_id:
            await runtime.sio.leave_room(sid, prev_room_id)
        await runtime.sio.enter_room(sid, room_id)
        runtime.sid_to_dm_room[sid] = room_id

    msg = {
        "id": str(uuid.uuid4()),
        "roomId": room_id,
        "senderId": str(user_id),
        "senderName": sender_name,
        "recipientId": str(recipient_id),
        "content": content,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "isSystem": False,
        "messageType": "dm",
    }

    await persist_dm_message(room_id, msg)
    await register_dm_thread_participants(str(user_id), str(recipient_id))

    # Redis adapter를 통한 room 브로드캐스트 (멀티 인스턴스/워커 대응)
    await runtime.sio.emit("receiveDmMessage", msg, room=room_id)

    # room 참여 여부와 무관하게 DM 당사자(보낸 사람/받는 사람)의 모든 세션에 직접 전달
    participant_ids = {str(user_id), str(recipient_id)}
    delivered_sids = set()

    for target_sid, uid in runtime.sid_to_user.items():
        if str(uid) not in participant_ids:
            continue
        if target_sid in delivered_sids:
            continue

        await runtime.sio.emit("receiveDmMessage", msg, to=target_sid)
        delivered_sids.add(target_sid)


@runtime.sio.on("markDmRead")
async def mark_dm_read(sid, data):
    user_id = runtime.sid_to_user.get(sid)
    if not user_id:
        return

    target_user_id = str((data or {}).get("targetUserId", "")).strip()
    timestamp = str((data or {}).get("timestamp", "")).strip()
    if not target_user_id:
        return

    if not timestamp:
        timestamp = datetime.utcnow().isoformat() + "Z"

    await register_dm_thread_participants(str(user_id), target_user_id)
    await set_dm_last_read(str(user_id), target_user_id, timestamp)


@runtime.sio.on("dmTyping")
async def dm_typing(sid, data):
    user_id = runtime.sid_to_user.get(sid)
    if not user_id:
        return

    # 채팅 금지 상태에서는 DM 타이핑 이벤트도 차단한다.
    if runtime.redis_client:
        ban_key = f"chat:banned:{user_id}"
        try:
            ban_raw = await runtime.redis_client.get(ban_key)
            if ban_raw:
                try:
                    ban_data = json.loads(ban_raw)
                except Exception:
                    ban_data = {}
                ttl = await runtime.redis_client.ttl(ban_key)
                is_permanent = is_permanent_ban(ban_data, ttl)
                if not is_permanent and ttl <= 0:
                    await runtime.redis_client.delete(ban_key)
                else:
                    return
        except Exception as exc:
            runtime.log("WARNING", f"DM typing 전 ban 체크 오류: {exc}")
    else:
        ban_data = runtime.banned_users_local.get(str(user_id))
        if ban_data:
            is_permanent = is_permanent_ban(ban_data)
            if is_permanent:
                return
            now_ts = datetime.utcnow().timestamp()
            expires_at = float(ban_data.get("expiresAtTs") or 0)
            ttl = int(max(0, expires_at - now_ts))
            if ttl > 0:
                return
            runtime.banned_users_local.pop(str(user_id), None)

    target_user_id = str((data or {}).get("targetUserId", "")).strip()
    room_id = str((data or {}).get("roomId", "")).strip()
    if not room_id and target_user_id:
        room_id = build_dm_room_id(str(user_id), target_user_id)
    if not room_id:
        return

    room_parts = room_id.split(":")
    if len(room_parts) != 3 or room_parts[0] != "dm":
        return

    participant_a, participant_b = room_parts[1], room_parts[2]
    if str(user_id) not in (participant_a, participant_b):
        return

    is_typing = bool((data or {}).get("isTyping", False))
    user_name = resolve_user_name(str(user_id))

    payload = {
        "roomId": room_id,
        "userId": str(user_id),
        "name": user_name,
        "isTyping": is_typing,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    participant_ids = {participant_a, participant_b}
    for target_sid, uid in runtime.sid_to_user.items():
        if target_sid == sid:
            continue
        if str(uid) not in participant_ids:
            continue
        await runtime.sio.emit("dmTyping", payload, to=target_sid)


@runtime.sio.on("kickUser")
async def kick_user(sid, data):
    actor_user_id = runtime.sid_to_user.get(sid)
    if not actor_user_id:
        return

    actor_role = str(runtime.sid_to_role.get(sid) or resolve_user_role(actor_user_id)).lower()
    if actor_role != "admin":
        runtime.log("WARNING", f"강퇴 권한 없음: actor={actor_user_id}")
        await runtime.sio.emit(
            "kickResult",
            {"ok": False, "reason": "권한이 없습니다."},
            to=sid,
        )
        return

    target_user_id = str((data or {}).get("targetUserId", "")).strip()
    reason = str((data or {}).get("reason", "규칙 위반")).strip()[:120]
    raw_ban_seconds = (data or {}).get("banSeconds", 0)
    try:
        ban_seconds = int(raw_ban_seconds)
    except (TypeError, ValueError):
        ban_seconds = 0
    is_permanent = ban_seconds == -1 or bool((data or {}).get("isPermanent", False))
    if not is_permanent:
        ban_seconds = max(0, min(ban_seconds, 86400))
    if not target_user_id:
        await runtime.sio.emit(
            "kickResult",
            {"ok": False, "reason": "대상 사용자가 없습니다."},
            to=sid,
        )
        return

    if str(actor_user_id) == target_user_id:
        await runtime.sio.emit(
            "kickResult",
            {"ok": False, "reason": "본인은 강퇴할 수 없습니다."},
            to=sid,
        )
        return

    actor_name = resolve_user_name(str(actor_user_id))
    target_name = resolve_user_name(target_user_id)
    target_sids = [
        target_sid
        for target_sid, uid in runtime.sid_to_user.items()
        if str(uid) == target_user_id
    ]

    if not target_sids:
        await runtime.sio.emit(
            "kickResult",
            {"ok": False, "reason": "대상이 오프라인입니다."},
            to=sid,
        )
        return

    action_label = "영구 정지" if is_permanent else "1일 채팅 금지" if ban_seconds > 0 else "강제 퇴장"
    action_phrase = "조치했습니다" if is_permanent or ban_seconds > 0 else "처리했습니다"
    system_message = {
        "id": str(uuid.uuid4()),
        "senderId": "system",
        "content": f"관리자 {actor_name}님이 {target_name}님을 {action_label} {action_phrase}. 사유: {reason}",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "isSystem": True,
    }

    await persist_message(system_message)
    await runtime.sio.emit("receiveMessage", system_message)

    for target_sid in target_sids:
        target_session_token = runtime.sid_to_session_token.get(target_sid)
        await runtime.sio.emit(
            "userKicked",
            {
                "targetUserId": target_user_id,
                "reason": reason,
                "banSeconds": -1 if is_permanent else ban_seconds,
                "ttlSeconds": 0 if is_permanent else ban_seconds,
                "isPermanent": is_permanent,
                "by": str(actor_user_id),
                "byName": actor_name,
            },
            to=target_sid,
        )
        # 강제 퇴장만 연결을 끊고, 기간/영구 채금은 읽기 전용으로 유지한다.
        if ban_seconds <= 0 and not is_permanent:
            if ban_seconds <= 0 and not is_permanent and target_session_token:
                token_set = runtime.kicked_session_tokens_local.setdefault(target_user_id, set())
                token_set.add(target_session_token)
            await runtime.sio.disconnect(target_sid)

    # ban_seconds > 0 이면 차단 기록 저장 (Redis 우선, 없으면 인메모리 fallback)
    if is_permanent or ban_seconds > 0:
        ban_key = f"chat:banned:{target_user_id}"
        now_dt = datetime.utcnow()
        ban_data = {
            "reason": reason,
            "by": str(actor_user_id),
            "byName": actor_name,
            "bannedAt": now_dt.isoformat() + "Z",
            "banSeconds": -1 if is_permanent else ban_seconds,
            "isPermanent": is_permanent,
            "targetName": target_name,
            "targetUserId": target_user_id,
            "expiresAtTs": None if is_permanent else now_dt.timestamp() + ban_seconds,
        }

        # Redis 조회 장애 시에도 관리자 목록/차단 검사가 즉시 동작하도록 로컬 미러를 항상 유지한다.
        runtime.banned_users_local[target_user_id] = ban_data

        if runtime.redis_client:
            try:
                if is_permanent:
                    await runtime.redis_client.set(ban_key, json.dumps(ban_data))
                    runtime.log("INFO", f"영구 정지: {target_user_id}")
                else:
                    await runtime.redis_client.setex(ban_key, ban_seconds, json.dumps(ban_data))
                    runtime.log("INFO", f"채팅 차단: {target_user_id} ({ban_seconds}초)")
            except Exception as exc:
                runtime.log("WARNING", f"차단 저장 실패: {exc}")
        else:
            runtime.log(
                "INFO",
                f"{'영구 정지' if is_permanent else '채팅 차단(메모리)'}: {target_user_id}"
                + ("" if is_permanent else f" ({ban_seconds}초)"),
            )

    await runtime.sio.emit(
        "kickResult",
        {
            "ok": True,
            "targetUserId": target_user_id,
            "targetName": target_name,
            "reason": reason,
            "banSeconds": -1 if is_permanent else ban_seconds,
            "isPermanent": is_permanent,
        },
        to=sid,
    )


# ==================== 차단 해제 ====================
@runtime.sio.on("unbanUser")
async def unban_user(sid, data):
    actor_user_id = runtime.sid_to_user.get(sid)
    if not actor_user_id:
        return

    actor_role = str(runtime.sid_to_role.get(sid) or resolve_user_role(actor_user_id)).lower()
    if actor_role != "admin":
        await runtime.sio.emit(
            "unbanResult",
            {"ok": False, "reason": "권한이 없습니다."},
            to=sid,
        )
        return

    target_user_id = str((data or {}).get("targetUserId", "")).strip()
    if not target_user_id:
        await runtime.sio.emit(
            "unbanResult",
            {"ok": False, "reason": "대상이 없습니다."},
            to=sid,
        )
        return

    ban_key = f"chat:banned:{target_user_id}"
    try:
        deleted = 0
        if runtime.redis_client:
            deleted = await runtime.redis_client.delete(ban_key)

        local_deleted = 1 if runtime.banned_users_local.pop(target_user_id, None) else 0
        deleted = int(bool(deleted or local_deleted))

        target_name = resolve_user_name(target_user_id)
        if deleted:
            runtime.log("INFO", f"차단 해제: {target_user_id} by {actor_user_id}")
            # 영구정지/강퇴로 누적된 세션 재접속 차단 토큰도 함께 해제한다.
            runtime.kicked_session_tokens_local.pop(target_user_id, None)
            await runtime.sio.emit(
                "unbanResult",
                {"ok": True, "targetUserId": target_user_id, "targetName": target_name},
                to=sid,
            )
            # ✅ 대상 사용자에게 unban 알림 (실시간 반영)
            target_sids = [
                target_sid
                for target_sid, uid in runtime.sid_to_user.items()
                if str(uid) == target_user_id
            ]
            if target_sids:
                actor_name = resolve_user_name(str(actor_user_id))
                for target_sid in target_sids:
                    await runtime.sio.emit(
                        "userUnbanned",
                        {
                            "targetUserId": target_user_id,
                            "by": str(actor_user_id),
                            "byName": actor_name,
                        },
                        to=target_sid,
                    )
        else:
            await runtime.sio.emit(
                "unbanResult",
                {"ok": False, "reason": "차단 내역이 없습니다."},
                to=sid,
            )
    except Exception as exc:
        runtime.log("WARNING", f"차단 해제 오류: {exc}")
        await runtime.sio.emit(
            "unbanResult",
            {"ok": False, "reason": "처리 중 오류가 발생했습니다."},
            to=sid,
        )


# ==================== 차단 목록 조회 ====================
@runtime.sio.on("getBannedUsers")
async def get_banned_users(sid, data=None):
    actor_user_id = runtime.sid_to_user.get(sid)
    if not actor_user_id:
        return

    actor_role = str(runtime.sid_to_role.get(sid) or resolve_user_role(actor_user_id)).lower()
    if actor_role != "admin":
        return

    now_ts = datetime.utcnow().timestamp()
    result = []
    try:
        if runtime.redis_client:
            try:
                keys = await runtime.redis_client.keys("chat:banned:*")
                for key in keys:
                    raw = await runtime.redis_client.get(key)
                    ttl = await runtime.redis_client.ttl(key)
                    if not raw:
                        continue
                    try:
                        entry = json.loads(raw)
                        is_permanent = bool(entry.get("isPermanent", False)) or ttl == -1
                        entry["isPermanent"] = is_permanent
                        entry["ttlSeconds"] = 0 if is_permanent else max(0, ttl)
                        result.append(entry)
                    except Exception:
                        pass
            except Exception as exc:
                runtime.log("WARNING", f"차단 목록 Redis 조회 오류: {exc}")

        # Redis 미사용/장애 시에도 목록이 보이도록 로컬 차단 정보 병합
        expired_local_ids = []
        redis_user_ids = {
            str(item.get("targetUserId", ""))
            for item in result
            if item.get("targetUserId")
        }
        for uid, entry in runtime.banned_users_local.items():
            if bool(entry.get("isPermanent", False)):
                if uid in redis_user_ids:
                    continue
                local_entry = dict(entry)
                local_entry["isPermanent"] = True
                local_entry["ttlSeconds"] = 0
                result.append(local_entry)
                continue

            expires_at = float(entry.get("expiresAtTs") or 0)
            ttl = int(max(0, expires_at - now_ts))
            if ttl <= 0:
                expired_local_ids.append(uid)
                continue
            if uid in redis_user_ids:
                continue

            local_entry = dict(entry)
            local_entry["ttlSeconds"] = ttl
            result.append(local_entry)

        for uid in expired_local_ids:
            runtime.banned_users_local.pop(uid, None)

        await runtime.sio.emit("bannedUsers", result, to=sid)
    except Exception as exc:
        runtime.log("WARNING", f"차단 목록 조회 오류: {exc}")
        await runtime.sio.emit("bannedUsers", result, to=sid)


# ==================== 서버 시작 이벤트 ====================
@runtime.sio.event
async def startup():
    ensure_redis_listener_started()
    if not runtime.redis_client:
        runtime.log("DEBUG", "Redis 없음 → Pub/Sub 리스너 시작 안 함")
        return

    await apply_dm_retention_policy_to_existing_keys()


sio = runtime.sio
websocket_app = runtime.websocket_app