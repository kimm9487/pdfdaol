import { useEffect } from "react";

// ────────────────────────────────────────────────────────────
// 새로고침(F5) 시 localStorage에서 DM 메타·채팅 메시지를 복원하는 후크
// userDbId/sessionToken이 확정된 후 한 번만 실행된다 (dmMetaHydratedRef 가드)
// ────────────────────────────────────────────────────────────
export const useWebSocketChatHydration = ({
  userDbId,
  sessionToken,
  getDmMetaStorageKey,
  setDmThreadUserIds,
  setDmLastByUser,
  setDmUserNamesById,
  setDmReadStateByUser,
  getDmUnreadStorageKey,
  setDmUnreadByUser,
  getDmReadStateStorageKey,
  getStorageKey,
  setMessages,
  getDmThreadStorageKey,
  readPersistedJson,
  getLegacyDmThreadStorageKey,
  getDmPartnerId,
  dmMetaHydratedRef,
}) => {
  useEffect(() => {
    if (!userDbId || !sessionToken) return;

    // 이미 hydration 완료된 경우 재실행하지 않음 (함수 참조 변경으로 재발화 방지)
    if (dmMetaHydratedRef.current) return;

    // ─── DM 메타(스레드·마지막 프리뷰·unread·이름·읽음상태) 복원 ────────────────
    let restoredThreadIds = [];
    let restoredLastByUser = {};
    let restoredUnreadByUser = {};
    let restoredUserNamesById = {};
    let restoredReadStateByUser = {};

    const dmMetaKey = getDmMetaStorageKey();
    if (dmMetaKey) {
      const savedMeta = localStorage.getItem(dmMetaKey);
      if (savedMeta) {
        try {
          const parsed = JSON.parse(savedMeta);
          if (Array.isArray(parsed?.threadUserIds)) {
            restoredThreadIds = parsed.threadUserIds.map((id) => String(id));
            setDmThreadUserIds(restoredThreadIds);
          }
          if (parsed?.lastByUser && typeof parsed.lastByUser === "object") {
            restoredLastByUser = parsed.lastByUser;
            setDmLastByUser(restoredLastByUser);
          }
          if (parsed?.unreadByUser && typeof parsed.unreadByUser === "object") {
            restoredUnreadByUser = parsed.unreadByUser;
          }
          if (
            parsed?.userNamesById &&
            typeof parsed.userNamesById === "object"
          ) {
            restoredUserNamesById = parsed.userNamesById;
            setDmUserNamesById(restoredUserNamesById);
          }
          if (
            parsed?.readStateByUser &&
            typeof parsed.readStateByUser === "object"
          ) {
            restoredReadStateByUser = parsed.readStateByUser;
            setDmReadStateByUser(restoredReadStateByUser);
          }
        } catch (e) {
          console.error("[LocalStorage] DM 메타 파싱 실패:", e);
        }
      }
    }

    // ─── DM unread 카운트 복원 (구 키 병합) ────────────────────────────
    const unreadKey = getDmUnreadStorageKey();
    if (unreadKey) {
      const savedUnread = localStorage.getItem(unreadKey);
      if (savedUnread) {
        try {
          const parsedUnread = JSON.parse(savedUnread);
          if (parsedUnread && typeof parsedUnread === "object") {
            const mergedUnread = { ...restoredUnreadByUser };
            Object.entries(parsedUnread).forEach(([uid, cnt]) => {
              mergedUnread[String(uid)] = Math.max(
                Number(mergedUnread[String(uid)] || 0),
                Number(cnt || 0),
              );
            });
            restoredUnreadByUser = mergedUnread;
          }
        } catch (e) {
          console.error("[LocalStorage] DM unread 파싱 실패:", e);
        }
      }
    }

    if (Object.keys(restoredUnreadByUser).length > 0) {
      setDmUnreadByUser(restoredUnreadByUser);
    }

    // ─── DM 읽음 상태 복원 ──────────────────────────────────────────
    const readStateKey = getDmReadStateStorageKey();
    if (readStateKey) {
      const savedReadState = localStorage.getItem(readStateKey);
      if (savedReadState) {
        try {
          const parsedReadState = JSON.parse(savedReadState);
          if (parsedReadState && typeof parsedReadState === "object") {
            restoredReadStateByUser = parsedReadState;
            setDmReadStateByUser(restoredReadStateByUser);
          }
        } catch (e) {
          console.error("[LocalStorage] DM read state 파싱 실패:", e);
        }
      }
    }

    // ─── 공개 채팅 메시지 복원 ────────────────────────────────────────────
    const key = getStorageKey();
    if (key) {
      const saved = sessionStorage.getItem(key); // localStorage 완전 제거
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setMessages(parsed);
            return; // 성공 시 종료
          }
        } catch {
          console.warn("[Storage] 공개채팅 파싱 실패, 초기화");
          sessionStorage.removeItem(key);
        }
      }
    }
    // sessionStorage에 없으면 명시적으로 빈 배열 (재로그인 시 빈 상태 보장)
    setMessages([]);

    // ─── DM 스레드 목록 복원 ────────────────────────────────────────────
    const threadKey = getDmThreadStorageKey();
    if (threadKey) {
      const { key: restoredThreadKey, value: parsedThreadValue } =
        readPersistedJson([threadKey, getLegacyDmThreadStorageKey()]);
      if (Array.isArray(parsedThreadValue)) {
        restoredThreadIds = parsedThreadValue.map((id) => String(id));
        setDmThreadUserIds(restoredThreadIds);
        if (restoredThreadKey && restoredThreadKey !== threadKey) {
          localStorage.setItem(threadKey, JSON.stringify(restoredThreadIds));
        }
      }
    }

    // ─── localStorage 전체 스캔으로 DM room 캐시 복구 ──────────────────────
    const suffix = sessionToken.slice(-12);
    const roomPrefixes = [
      userDbId ? `chat_dm_room_user_${userDbId}_` : null,
      userDbId && sessionToken
        ? `chat_dm_user_${userDbId}_sess_${suffix}_`
        : null,
    ].filter(Boolean);

    const discoveredSet = new Set();
    const recoveredLastByUser = { ...restoredLastByUser };
    const recoveredUserNamesById = { ...restoredUserNamesById };

    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      const matchedPrefix = roomPrefixes.find((prefix) =>
        storageKey?.startsWith(prefix),
      );
      if (!storageKey || !matchedPrefix) continue;

      const roomId = storageKey.slice(matchedPrefix.length);
      const partnerId = getDmPartnerId(roomId, String(userDbId));
      if (!partnerId) continue;

      discoveredSet.add(partnerId);

      const rawRoom = localStorage.getItem(storageKey);
      if (!rawRoom) continue;

      try {
        const parsedRoom = JSON.parse(rawRoom);
        if (!Array.isArray(parsedRoom) || parsedRoom.length === 0) continue;

        let latest = null;
        for (let i = parsedRoom.length - 1; i >= 0; i -= 1) {
          const item = parsedRoom[i];
          if (item?.timestamp && !isNaN(new Date(item.timestamp).getTime())) {
            latest = item;
            break;
          }
        }

        if (!latest) {
          latest = parsedRoom[parsedRoom.length - 1];
        }

        if (!latest) continue;

        if (
          String(latest.senderId || "") === String(partnerId) &&
          String(latest.senderName || "").trim()
        ) {
          recoveredUserNamesById[partnerId] = String(latest.senderName).trim();
        }

        const latestPreview =
          latest.content || latest.message || latest.text || "";
        const latestTimestamp = latest.timestamp
          ? new Date(latest.timestamp).toISOString()
          : new Date().toISOString();
        const lastReadTs =
          new Date(restoredReadStateByUser[partnerId] || 0).getTime() || 0;
        const computedUnread = parsedRoom.filter((item) => {
          const itemTs = new Date(item?.timestamp || 0).getTime() || 0;
          return (
            String(item?.senderId || "") === String(partnerId) &&
            itemTs > lastReadTs
          );
        }).length;

        if (computedUnread > 0) {
          restoredUnreadByUser[partnerId] = Math.max(
            Number(restoredUnreadByUser[partnerId] || 0),
            computedUnread,
          );
        }
        const existing = recoveredLastByUser[partnerId];

        if (!existing) {
          recoveredLastByUser[partnerId] = {
            preview: latestPreview,
            timestamp: latestTimestamp,
            senderName: latest.senderName || "",
          };
          continue;
        }

        const existingTs = new Date(existing.timestamp || 0).getTime() || 0;
        const latestTs = new Date(latestTimestamp).getTime() || 0;
        if (latestTs >= existingTs) {
          recoveredLastByUser[partnerId] = {
            preview: latestPreview || existing.preview || "",
            timestamp: latestTimestamp,
            senderName: latest.senderName || existing.senderName || "",
          };
        }
      } catch (e) {
        console.error("[LocalStorage] DM room 캐시 파싱 실패:", e);
      }
    }

    // ─── 모든 소스 병합 + 최종 상태 반영 + 메타 저장 ─────────────────────
    const finalThreadSet = new Set(restoredThreadIds);
    discoveredSet.forEach((id) => finalThreadSet.add(String(id)));
    Object.keys(recoveredLastByUser || {}).forEach((id) =>
      finalThreadSet.add(String(id)),
    );
    Object.keys(restoredUnreadByUser || {}).forEach((id) =>
      finalThreadSet.add(String(id)),
    );
    const finalThreadIds = Array.from(finalThreadSet);
    setDmThreadUserIds(finalThreadIds);
    if (threadKey)
      localStorage.setItem(threadKey, JSON.stringify(finalThreadIds));
    if (Object.keys(restoredUnreadByUser).length > 0) {
      setDmUnreadByUser(restoredUnreadByUser);
    }

    if (Object.keys(recoveredLastByUser).length > 0) {
      setDmLastByUser(recoveredLastByUser);
    }

    if (Object.keys(recoveredUserNamesById).length > 0) {
      setDmUserNamesById(recoveredUserNamesById);
    }

    if (dmMetaKey) {
      localStorage.setItem(
        dmMetaKey,
        JSON.stringify({
          threadUserIds: finalThreadIds,
          lastByUser: recoveredLastByUser,
          unreadByUser: restoredUnreadByUser,
          userNamesById: recoveredUserNamesById,
          readStateByUser: restoredReadStateByUser,
        }),
      );
    }

    dmMetaHydratedRef.current = true;
  }, [
    userDbId,
    sessionToken,
    getDmMetaStorageKey,
    setDmThreadUserIds,
    setDmLastByUser,
    setDmUserNamesById,
    setDmReadStateByUser,
    getDmUnreadStorageKey,
    setDmUnreadByUser,
    getDmReadStateStorageKey,
    getStorageKey,
    setMessages,
    getDmThreadStorageKey,
    readPersistedJson,
    getLegacyDmThreadStorageKey,
    getDmPartnerId,
    dmMetaHydratedRef,
  ]);
};

export const useWebSocketChatPostEffects = ({
  userDbId,
  sessionToken,
  userId,
  dmMetaHydratedRef,
  resetDmRuntimeState,
  setMessages,
  setDmUnreadByUser,
  setDmThreadUserIds,
  setDmLastByUser,
  setDmUserNamesById,
  setDmReadStateByUser,
  setUnreadCount,
  setOnlineUsers,
  showChat,
  isViewingChatTab,
  setMessagesForRead,
  messages,
  setUnreadCountFromMessages,
  getStorageKey,
  getDmMetaStorageKey,
  dmThreadUserIds,
  dmLastByUser,
  dmUnreadByUser,
  dmUserNamesById,
  dmReadStateByUser,
  isConnected,
  socket,
}) => {
  // DM 메타 변경 시 localStorage 동기화
  useEffect(() => {
    if (!userDbId || !sessionToken) return;
    if (!dmMetaHydratedRef.current) return;
    const dmMetaKey = getDmMetaStorageKey();
    if (!dmMetaKey) return;

    const timeoutId = setTimeout(() => {
      localStorage.setItem(
        dmMetaKey,
        JSON.stringify({
          threadUserIds: dmThreadUserIds,
          lastByUser: dmLastByUser,
          unreadByUser: dmUnreadByUser,
          userNamesById: dmUserNamesById,
          readStateByUser: dmReadStateByUser,
        }),
      );
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [
    userDbId,
    sessionToken,
    dmThreadUserIds,
    dmLastByUser,
    dmUnreadByUser,
    dmUserNamesById,
    dmReadStateByUser,
    getDmMetaStorageKey,
    dmMetaHydratedRef,
  ]);

  useEffect(() => {
    if (!isConnected || !socket) return;
    if (!dmMetaHydratedRef.current) return;
    if (!dmThreadUserIds.length) return;

    socket.emit("getDmThreadSummaries", {
      targetUserIds: dmThreadUserIds,
      lastReadByUser: dmReadStateByUser,
    });
  }, [
    isConnected,
    socket,
    dmThreadUserIds,
    dmReadStateByUser,
    dmMetaHydratedRef,
  ]);

  // 세션 만료/로그아웃 시 모든 채팅 상태 초기화 + localStorage 정리
  useEffect(() => {
    if (!sessionToken || !userDbId) {
      dmMetaHydratedRef.current = false;
      const prefixes = [
        userDbId ? `chat_messages_user_${userDbId}_sess_` : null,
        userId ? `chat_messages_user_${userId}_sess_` : null,
      ].filter(Boolean);

      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      setMessages([]);
      resetDmRuntimeState();
      setDmUnreadByUser({});
      setDmThreadUserIds([]);
      setDmLastByUser({});
      setDmUserNamesById({});
      setDmReadStateByUser({});
      setUnreadCount(0);
      setOnlineUsers([]);
    }
  }, [
    sessionToken,
    userDbId,
    userId,
    dmMetaHydratedRef,
    resetDmRuntimeState,
    setMessages,
    setDmUnreadByUser,
    setDmThreadUserIds,
    setDmLastByUser,
    setDmUserNamesById,
    setDmReadStateByUser,
    setUnreadCount,
    setOnlineUsers,
  ]);

  // 채팅 탭 포커스 시 메시지 읽음 처리
  useEffect(() => {
    if (showChat && isViewingChatTab) {
      setMessagesForRead((prev) => {
        const updated = prev.map((msg) => ({ ...msg, isRead: true }));
        const key = getStorageKey();
        if (key) {
          sessionStorage.setItem(key, JSON.stringify(updated)); // ← sessionStorage
        }
        return updated;
      });
      setUnreadCount(0);
    }
  }, [
    showChat,
    isViewingChatTab,
    setMessagesForRead,
    getStorageKey,
    setUnreadCount,
  ]);

  // 채팅 탭 비활성 시 안읽은 메시지 수 계산
  useEffect(() => {
    if (!showChat || !isViewingChatTab) {
      const count = messages.filter(
        (msg) => !msg.isSystem && !msg.isRead,
      ).length;
      setUnreadCountFromMessages(count);
    }
  }, [messages, showChat, isViewingChatTab, setUnreadCountFromMessages]);
};