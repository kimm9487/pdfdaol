// userId 값을 trim된 문자열로 정규화
export const normalizeWebSocketUserId = (value) => String(value ?? "").trim();

// 두 userId를 정렬하여 항상 동일한 형태의 룸 ID (dm:{소}:{대}) 생성
export const buildWebSocketDmRoomId = (userA, userB) => {
  const users = [normalizeWebSocketUserId(userA), normalizeWebSocketUserId(userB)].sort(
    (a, b) => {
      const aNum = /^\d+$/.test(a);
      const bNum = /^\d+$/.test(b);
      if (aNum && bNum) return Number(a) - Number(b);
      return a.localeCompare(b);
    },
  );
  return `dm:${users[0]}:${users[1]}`;
};

// 룸 ID에서 내 ID를 제외한 상대방 userId 반환
export const getWebSocketDmPartnerId = (roomId, myId) => {
  const parts = String(roomId || "").split(":");
  if (parts.length !== 3 || parts[0] !== "dm") return "";
  const a = String(parts[1] || "");
  const b = String(parts[2] || "");
  return a === myId ? b : a;
};

// localStorage 키 생성·JSON 읽기·DM 메시지 저장 유틸 팩토리
export const createWebSocketChatStorage = ({
  userDbId,
  sessionToken,
  storage = localStorage,
}) => {
  // ─── 스토리지 키 생성 함수 ───────────────────────────────────────
  const sessionSuffix = sessionToken ? sessionToken.slice(-12) : "";

  const getStorageKey = () =>
    userDbId && sessionToken
      ? `chat_messages_user_${userDbId}_sess_${sessionSuffix}`
      : null;

  const getDmStorageKey = (roomId) =>
    userDbId && roomId ? `chat_dm_room_user_${userDbId}_${roomId}` : null;

  const getLegacyDmStorageKey = (roomId) =>
    userDbId && sessionToken && roomId
      ? `chat_dm_user_${userDbId}_sess_${sessionSuffix}_${roomId}`
      : null;

  const getDmThreadStorageKey = () =>
    userDbId ? `chat_dm_threads_user_${userDbId}` : null;

  const getLegacyDmThreadStorageKey = () =>
    userDbId && sessionToken
      ? `chat_dm_threads_user_${userDbId}_sess_${sessionSuffix}`
      : null;

  const getDmMetaStorageKey = () =>
    userDbId ? `chat_dm_meta_user_${userDbId}` : null;

  const getDmUnreadStorageKey = () =>
    userDbId ? `chat_dm_unread_user_${userDbId}` : null;

  const getDmReadStateStorageKey = () =>
    userDbId ? `chat_dm_read_state_user_${userDbId}` : null;

  const getBanInfoCacheKey = () =>
    userDbId ? `chat_ban_perm_user_${userDbId}` : null;

  const getKickErrorCacheKey = () =>
    userDbId ? `chat_kick_error_user_${userDbId}` : null;

  // ─── JSON 읽기 / DM 메시지 저장 ────────────────────────────────────
  const readPersistedJson = (keys = []) => {
    for (const key of keys) {
      if (!key) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      try {
        return { key, value: JSON.parse(raw) };
      } catch (error) {
        console.error("[LocalStorage] JSON 파싱 실패:", error);
      }
    }
    return { key: null, value: null };
  };

  const persistDmRoomMessages = (roomId, messages) => {
    const nextKey = getDmStorageKey(roomId);
    if (nextKey) {
      storage.setItem(nextKey, JSON.stringify(messages));
    }
  };

  return {
    getStorageKey,
    getDmStorageKey,
    getLegacyDmStorageKey,
    getDmThreadStorageKey,
    getLegacyDmThreadStorageKey,
    getDmMetaStorageKey,
    getDmUnreadStorageKey,
    getDmReadStateStorageKey,
    getBanInfoCacheKey,
    getKickErrorCacheKey,
    readPersistedJson,
    persistDmRoomMessages,
  };
};