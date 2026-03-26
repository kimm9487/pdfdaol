// 소켓 이벤트 핸들러 팩토리 (챗·DM 전송, 룸 관리, 강퇴/밴, 타이핑)
export const createWebSocketChatHandlers = ({
  socket,
  userDbId,
  normalizeUserId,
  buildDmRoomId,
  getDmStorageKey,
  getLegacyDmStorageKey,
  getDmThreadStorageKey,
  readPersistedJson,
  persistDmRoomMessages,
  registerDmThreadUser,
  markDmThreadRead,
  setActiveDmUserId,
  setDmRoomId,
  dmRoomIdRef,
  setDmTypingUsers,
  setDmMessages,
  activeDmUserIdRef,
  setDmThreadUserIds,
  setDmUnreadByUserAndPersist,
  setDmReadStateByUserAndPersist,
  setDmLastByUser,
  dmTypingHeartbeatRef,
  typingHeartbeatRef,
  storage = localStorage,
}) => {
  // 공개 채팅 메시지 전송 + typing off emit
  const handleSendMessage = (text) => {
    if (!text?.trim() || !socket?.connected) return false;
    socket.emit("sendMessage", {
      content: text,
      userId: userDbId,
    });

    socket.emit("typing", {
      userId: userDbId,
      isTyping: false,
    });
    typingHeartbeatRef.current = 0;
    return true;
  };

  // DM 룸 활성화: 상태 설정 + localStorage 메시지 복원 + joinDmRoom emit
  const handleOpenDm = (targetUserId) => {
    const targetId = normalizeUserId(targetUserId);
    const myId = normalizeUserId(userDbId);
    if (!targetId || !myId) return false;

    const roomId = buildDmRoomId(myId, targetId);
    setActiveDmUserId(targetId);
    setDmRoomId(roomId);
    dmRoomIdRef.current = roomId;
    setDmTypingUsers([]);
    registerDmThreadUser(targetId);

    const nextRoomKey = getDmStorageKey(roomId);
    const { key: restoredRoomKey, value: parsedRoomValue } = readPersistedJson([
      nextRoomKey,
      getLegacyDmStorageKey(roomId),
    ]);
    if (Array.isArray(parsedRoomValue)) {
      setDmMessages(parsedRoomValue);
      if (restoredRoomKey && restoredRoomKey !== nextRoomKey) {
        persistDmRoomMessages(roomId, parsedRoomValue);
      }
    } else {
      setDmMessages([]);
    }

    markDmThreadRead(targetId);

    if (socket?.connected) {
      socket.emit("joinDmRoom", { targetUserId: targetId });
    }
    return true;
  };

  // DM 룸 비활성화: 관련 상태 모두 초기화
  const handleCloseDmRoom = () => {
    setActiveDmUserId(null);
    setDmRoomId("");
    dmRoomIdRef.current = "";
    setDmTypingUsers([]);
  };

  // DM 스레드 삭제: localStorage 정리 + 상태에서 제거
  const handleDeleteDmThread = (targetUserId) => {
    const targetId = normalizeUserId(targetUserId);
    const myId = normalizeUserId(userDbId);
    if (!targetId || !myId) return false;

    const roomId = buildDmRoomId(myId, targetId);
    [getDmStorageKey(roomId), getLegacyDmStorageKey(roomId)]
      .filter(Boolean)
      .forEach((roomKey) => storage.removeItem(roomKey));

    setDmThreadUserIds((prev) => {
      const updated = prev.filter((id) => id !== targetId);
      const threadKey = getDmThreadStorageKey?.();
      if (threadKey) storage.setItem(threadKey, JSON.stringify(updated));
      return updated;
    });
    setDmUnreadByUserAndPersist((prev) => {
      const updated = { ...prev };
      delete updated[targetId];
      return updated;
    });
    setDmReadStateByUserAndPersist((prev) => {
      const updated = { ...prev };
      delete updated[targetId];
      return updated;
    });
    setDmLastByUser((prev) => {
      const updated = { ...prev };
      delete updated[targetId];
      return updated;
    });

    if (normalizeUserId(activeDmUserIdRef.current) === targetId) {
      handleCloseDmRoom();
      setDmMessages([]);
    }

    return true;
  };

  // DM 메시지 전송 + typing off emit
  const handleSendDmMessage = (targetUserId, text) => {
    if (!text?.trim() || !socket?.connected) return false;

    const myId = normalizeUserId(userDbId);
    const targetId = normalizeUserId(targetUserId);
    if (!myId || !targetId) return false;

    const roomId = buildDmRoomId(myId, targetId);
    socket.emit("sendDmMessage", {
      roomId,
      targetUserId: targetId,
      content: text,
    });

    socket.emit("dmTyping", {
      roomId,
      targetUserId: targetId,
      isTyping: false,
    });
    dmTypingHeartbeatRef.current = 0;
    return true;
  };

  // 유저 강퇴/채팅 금지 처리 (banSeconds -1 = 영구 정지)
  const handleKickUser = (targetUserId, reason, banSeconds = 0) => {
    const targetId = normalizeUserId(targetUserId);
    if (!targetId || !socket?.connected) return false;

    socket.emit("kickUser", {
      targetUserId: targetId,
      reason: String(reason || "규칙 위반").slice(0, 120),
      banSeconds: Number(banSeconds),
      isPermanent: Number(banSeconds) === -1,
    });
    return true;
  };

  // 밴 해제 요청 emit
  const handleUnbanUser = (targetUserId) => {
    if (!socket?.connected) return;
    socket.emit("unbanUser", { targetUserId: String(targetUserId) });
  };

  // 밴 목록 조회 요청 emit
  const handleGetBannedUsers = () => {
    if (!socket?.connected) return;
    socket.emit("getBannedUsers");
  };

  // DM 입력 중 이벤트 emit (2초 heartbeat 간격으로 제한)
  const handleDmTypingChange = (targetUserId, value) => {
    if (!socket?.connected || !userDbId) return;

    const myId = normalizeUserId(userDbId);
    const targetId = normalizeUserId(targetUserId);
    if (!myId || !targetId) return;

    const roomId = buildDmRoomId(myId, targetId);
    const hasValue = Boolean(value?.trim());
    const now = Date.now();

    if (!hasValue) {
      socket.emit("dmTyping", { roomId, targetUserId: targetId, isTyping: false });
      dmTypingHeartbeatRef.current = 0;
      return;
    }

    if (now - dmTypingHeartbeatRef.current > 2000) {
      socket.emit("dmTyping", { roomId, targetUserId: targetId, isTyping: true });
      dmTypingHeartbeatRef.current = now;
    }
  };

  // 공개 채팅 입력 중 이벤트 emit (2초 heartbeat 간격으로 제한)
  const handleTypingChange = (value) => {
    if (!socket?.connected || !userDbId) return;

    const hasValue = Boolean(value?.trim());
    const now = Date.now();

    if (!hasValue) {
      socket.emit("typing", { userId: userDbId, isTyping: false });
      typingHeartbeatRef.current = 0;
      return;
    }

    if (now - typingHeartbeatRef.current > 2000) {
      socket.emit("typing", { userId: userDbId, isTyping: true });
      typingHeartbeatRef.current = now;
    }
  };

  return {
    handleSendMessage,
    handleOpenDm,
    handleCloseDmRoom,
    handleDeleteDmThread,
    handleSendDmMessage,
    handleKickUser,
    handleUnbanUser,
    handleGetBannedUsers,
    handleDmTypingChange,
    handleTypingChange,
  };
};
