// DM 스레드 상태 관리 함수 팩토리 (등록·프리뷰·unread·읽음 처리)
export const createWebSocketChatDmHelpers = ({
  normalizeUserId,
  getDmThreadStorageKey,
  setDmThreadUserIds,
  setDmLastByUser,
  dmUserNamesByIdRef,
  onlineUsersRef,
  dmLastByUserRef,
  getDmUnreadStorageKey,
  setDmUnreadByUser,
  getDmReadStateStorageKey,
  setDmReadStateByUser,
  socket,
  storage = localStorage,
}) => {
  // DM 스레드 목록에 userId 추가 + localStorage 동기화
  const registerDmThreadUser = (targetUserId) => {
    const targetId = normalizeUserId(targetUserId);
    if (!targetId) return;

    setDmThreadUserIds((prev) => {
      if (prev.includes(targetId)) return prev;
      const updated = [targetId, ...prev];
      const key = getDmThreadStorageKey();
      if (key) storage.setItem(key, JSON.stringify(updated));
      return updated;
    });
  };

  // DM 목록 마지막 메시지 프리뷰(내용·시간·이름) 업데이트
  const updateDmLastPreview = (targetUserId, message, fallbackName = "") => {
    const targetId = normalizeUserId(targetUserId);
    if (!targetId || !message?.content) return;

    setDmLastByUser((prev) => ({
      ...prev,
      [targetId]: {
        preview: message.content,
        timestamp: message.timestamp || new Date().toISOString(),
        senderName:
          fallbackName ||
          prev[targetId]?.senderName ||
          message.senderName ||
          "",
      },
    }));
  };

  // 알려진 유저 이름 조회 (캐시 ref → onlineUsers → lastByUser 순)
  const getKnownUserName = (targetUserId) => {
    const targetId = normalizeUserId(targetUserId);
    if (!targetId) return "";

    const cached = String(dmUserNamesByIdRef.current?.[targetId] || "").trim();
    if (cached) return cached;

    const found = onlineUsersRef.current.find(
      (u) => normalizeUserId(u?.userId ?? u?.id) === targetId,
    );
    if (found?.name) return String(found.name);

    return String(dmLastByUserRef.current?.[targetId]?.senderName || "");
  };

  // unread 카운트 상태 업데이트 + localStorage 동기화
  const setDmUnreadByUserAndPersist = (updater) => {
    setDmUnreadByUser((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const key = getDmUnreadStorageKey();
      if (key) {
        storage.setItem(key, JSON.stringify(next || {}));
      }
      return next;
    });
  };

  // 읽음 타임스탬프 상태 업데이트 + localStorage 동기화
  const setDmReadStateByUserAndPersist = (updater) => {
    setDmReadStateByUser((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const key = getDmReadStateStorageKey();
      if (key) {
        storage.setItem(key, JSON.stringify(next || {}));
      }
      return next;
    });
  };

  // DM 스레드 읽음 처리: read state 갱신 + unread 0 초기화 + markDmRead emit
  const markDmThreadRead = (targetUserId, timestamp = new Date().toISOString()) => {
    const targetId = normalizeUserId(targetUserId);
    if (!targetId) return;

    setDmReadStateByUserAndPersist((prev) => ({
      ...prev,
      [targetId]: timestamp,
    }));
    setDmUnreadByUserAndPersist((prev) => ({
      ...prev,
      [targetId]: 0,
    }));

    if (socket?.connected) {
      socket.emit("markDmRead", {
        targetUserId: targetId,
        timestamp,
      });
    }
  };

  return {
    registerDmThreadUser,
    updateDmLastPreview,
    getKnownUserName,
    setDmUnreadByUserAndPersist,
    setDmReadStateByUserAndPersist,
    markDmThreadRead,
  };
};