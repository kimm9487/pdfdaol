/* eslint-disable react-hooks/exhaustive-deps */
import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import WebSocketChatWindow from "./websocketchat/WebSocketChatWindow";
import "./websocketchat/WebSocketChat.css";
import {
  buildWebSocketDmRoomId,
  createWebSocketChatStorage,
  getWebSocketDmPartnerId,
  normalizeWebSocketUserId,
} from "./websocketchat/WebSocketChatStorage";
import { createWebSocketChatDmHelpers } from "./websocketchat/WebSocketChatDmHelpers";
import { createWebSocketChatHandlers } from "./websocketchat/WebSocketChatHandlers";
import {
  useWebSocketChatHydration,
  useWebSocketChatPostEffects,
} from "./websocketchat/WebSocketChatStateEffects";
import { io } from "socket.io-client";
import toast from "react-hot-toast";

export default function WebSocketChat() {
  // 로그아웃 시점에 공개채팅 메시지 상태 초기화
  useEffect(() => {
    const handleAuthChange = () => {
      console.log(
        "[WebSocketChat] authStateChanged → 공개채팅(sessionStorage) 초기화",
      );

      setMessages([]);
      setUnreadCount(0);

      // sessionStorage 청소
      Object.keys(sessionStorage).forEach((key) => {
        if (
          key.startsWith("public_chat_") ||
          key.startsWith("chat_messages_user_")
        ) {
          sessionStorage.removeItem(key);
        }
      });
    };

    window.addEventListener("authStateChanged", handleAuthChange);
    return () =>
      window.removeEventListener("authStateChanged", handleAuthChange);
  }, []);

  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [dmMessages, setDmMessages] = useState([]);
  const [dmRoomId, setDmRoomId] = useState("");
  const [activeDmUserId, setActiveDmUserId] = useState(null);
  const [dmUnreadByUser, setDmUnreadByUser] = useState({});
  const [dmThreadUserIds, setDmThreadUserIds] = useState([]);
  const [dmLastByUser, setDmLastByUser] = useState({});
  const [dmUserNamesById, setDmUserNamesById] = useState({});
  const [dmReadStateByUser, setDmReadStateByUser] = useState({});
  const [isViewingDmRoom, setIsViewingDmRoom] = useState(false);
  const [isViewingChatTab, setIsViewingChatTab] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [connectionError, setConnectionError] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [dmTypingUsers, setDmTypingUsers] = useState([]);
  const [banInfo, setBanInfo] = useState(null); // 내가 차단당했을 때
  const [bannedUsers, setBannedUsers] = useState([]); // 관리자용 차단 목록

  // 플로팅 패널 외부 클릭 감지를 위한 ref
  const chatPanelRef = useRef(null);
  const chatButtonRef = useRef(null);

  // 입력 중 이벤트 트래픽 완화를 위한 heartbeat/만료 ref
  const typingHeartbeatRef = useRef(0);
  const typingUserTimersRef = useRef(new Map());
  const dmTypingHeartbeatRef = useRef(0);
  const dmTypingUserTimersRef = useRef(new Map());
  const showChatRef = useRef(false);
  const dmRoomIdRef = useRef("");
  const activeDmUserIdRef = useRef(null);
  const isViewingDmRoomRef = useRef(false);
  const isViewingChatTabRef = useRef(false);
  const dmMetaHydratedRef = useRef(false);
  const dmLastByUserRef = useRef({});
  const dmUserNamesByIdRef = useRef({});
  const dmThreadUserIdsRef = useRef([]);
  const dmReadStateByUserRef = useRef({});
  const onlineUsersRef = useRef([]);
  const processedDmMessageIdsRef = useRef(new Set());
  const moderationDisconnectRef = useRef(null);
  const pendingBanCheckRef = useRef(false); // 재연결 시 kickRejected 대기 중 여부

  const userId = localStorage.getItem("userId");
  const userDbId = localStorage.getItem("userDbId") || userId;
  const sessionToken = localStorage.getItem("session_token");
  const hasAuthSession = Boolean(sessionToken && userDbId);

  const normalizeUserId = normalizeWebSocketUserId;
  const buildDmRoomId = buildWebSocketDmRoomId;
  const getDmPartnerId = getWebSocketDmPartnerId;

  const {
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
  } = useMemo(
    () =>
      createWebSocketChatStorage({
        userDbId,
        sessionToken,
        storage: sessionStorage,
      }),
    [userDbId, sessionToken],
  );

  const {
    registerDmThreadUser,
    updateDmLastPreview,
    getKnownUserName,
    setDmUnreadByUserAndPersist,
    setDmReadStateByUserAndPersist,
    markDmThreadRead,
  } = useMemo(
    () =>
      createWebSocketChatDmHelpers({
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
        storage: localStorage, // DM은 기존대로 localStorage 사용
      }),
    // socket이 바뀔 때만 재생성, storage 함수들은 이미 useMemo로 안정화됨
    [
      socket,
      getDmThreadStorageKey,
      getDmUnreadStorageKey,
      getDmReadStateStorageKey,
    ],
  );

  const resetDmRuntimeState = useCallback(() => {
    setDmMessages([]);
    setDmRoomId("");
    setActiveDmUserId(null);
    setDmTypingUsers([]);
    setIsViewingDmRoom(false);
  }, []);
  // ==================== 플로팅 패널 외부 클릭 시 닫기 ====================
  useEffect(() => {
    if (!showChat) return;

    const handleOutsideClick = (event) => {
      const target = event.target;
      if (
        chatPanelRef.current &&
        !chatPanelRef.current.contains(target) &&
        chatButtonRef.current &&
        !chatButtonRef.current.contains(target)
      ) {
        setShowChat(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showChat]);

  // 수신 이벤트 핸들러에서 최신 showChat 상태를 읽기 위한 ref 동기화
  useEffect(() => {
    showChatRef.current = showChat;
  }, [showChat]);

  useEffect(() => {
    dmRoomIdRef.current = dmRoomId;
  }, [dmRoomId]);

  useEffect(() => {
    activeDmUserIdRef.current = activeDmUserId;
  }, [activeDmUserId]);

  useEffect(() => {
    isViewingDmRoomRef.current = isViewingDmRoom;
  }, [isViewingDmRoom]);

  useEffect(() => {
    isViewingChatTabRef.current = isViewingChatTab;
  }, [isViewingChatTab]);

  useEffect(() => {
    dmLastByUserRef.current = dmLastByUser;
  }, [dmLastByUser]);

  useEffect(() => {
    dmUserNamesByIdRef.current = dmUserNamesById;
  }, [dmUserNamesById]);

  useEffect(() => {
    dmThreadUserIdsRef.current = dmThreadUserIds;
  }, [dmThreadUserIds]);

  useEffect(() => {
    dmReadStateByUserRef.current = dmReadStateByUser;
  }, [dmReadStateByUser]);

  useEffect(() => {
    onlineUsersRef.current = onlineUsers;
  }, [onlineUsers]);

  useEffect(() => {
    if (!onlineUsers.length) return;

    setDmUserNamesById((prev) => {
      const updated = { ...prev };
      for (const user of onlineUsers) {
        const uid = normalizeUserId(user?.userId ?? user?.id);
        const name = String(user?.name || "").trim();
        if (!uid || !name) continue;
        updated[uid] = name;
      }
      return updated;
    });
  }, [onlineUsers]);

  // ==================== 로그인 직후 백그라운드 연결 ====================
  useEffect(() => {
    // hasAuthSession이 false일 때 (로그아웃 / 세션 만료)
    if (!hasAuthSession) {
      if (socket) {
        try {
          if (socket.connected) socket.emit("logout");
          socket.disconnect();
        } catch (e) {
          console.warn("[WebSocketChat] socket disconnect error on logout", e);
        }
      }

      // ✅ 공개채팅 완전 초기화 (sessionStorage 청소 + 상태 초기화)ㄴ
      setMessages([]);
      setUnreadCount(0);

      // sessionStorage 청소 (더 안전한 방식)
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (
          key &&
          (key.startsWith("public_chat_") ||
            key.startsWith("chat_messages_user_"))
        ) {
          sessionStorage.removeItem(key);
        }
      }

      // DM 상태 초기화
      resetDmRuntimeState();
      setDmUnreadByUser({});
      setDmThreadUserIds([]);
      setDmLastByUser({});
      setDmUserNamesById({});
      setDmReadStateByUser({});
      setDmMessages([]);
      setOnlineUsers([]);
      setIsConnected(false);
      setBanInfo(null);
      setConnectionError(null);
      setSocket(null);

      return;
    }

    // ✅ WebSocket URL: 환경변수(VITE_SOCKET_URL) → 없으면 현재 페이지 origin 사용
    const getSocketUrl = () => {
      if (import.meta.env.VITE_SOCKET_URL) {
        return import.meta.env.VITE_SOCKET_URL;
      }
      return window.location.origin;
    };

    // 프로토콜 자동 변환 (https → wss, http → ws)
    let socketUrl = getSocketUrl();
    if (window.location.protocol === "https:") {
      socketUrl = socketUrl.replace(/^http:/, "https:");
      socketUrl = socketUrl.replace(/^ws:/, "wss:");
    } else {
      socketUrl = socketUrl.replace(/^wss:/, "ws:");
    }

    // 강퇴 경고 문구 복원 → F5/재접속 시 즉시 동일 문구 표시
    const kickErrKey = getKickErrorCacheKey();
    const savedKickError = kickErrKey ? localStorage.getItem(kickErrKey) : null;
    if (savedKickError) {
      setConnectionError(savedKickError);
    }

    // 영구 정지 & 1일 채팅금지 상태 localStorage에서 복원 → F5/재접속 시 ban 공지 즉시 표시
    const banCacheKey = getBanInfoCacheKey();
    const savedBanRaw = banCacheKey ? localStorage.getItem(banCacheKey) : null;
    let hasSavedBan = false;
    let hasSavedPermanentBan = false;
    if (savedBanRaw) {
      try {
        const parsed = JSON.parse(savedBanRaw);
        // ✅ 영구 정지 또는 1일 채팅금지 모두 복원
        if (parsed?.isPermanent || Number(parsed?.banSeconds || 0) > 0) {
          hasSavedBan = true;
          hasSavedPermanentBan = Boolean(
            parsed?.isPermanent || Number(parsed?.banSeconds || 0) === -1,
          );
          setBanInfo(parsed);
          setShowChat(true);
        }
      } catch {
        /* 파싱 실패 시 무시 */
      }
    }
    // 복원된 영구 정지가 있으면 바로 "ban" ref 설정 (connect에서 banInfo 안 지움)
    moderationDisconnectRef.current = hasSavedBan ? "ban" : "pending";

    // Socket.IO 연결 (✅ reconnection 강화)
    const newSocket = io(socketUrl, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20, // ← 20번 시도 (이전: 5)
      reconnectionDelay: 1000, // ← 1초 시작
      reconnectionDelayMax: 10000, // ← 최대 10초
      timeout: 20000,
      auth: { session_token: sessionToken },
      withCredentials: true,
    });

    newSocket.on("connect", () => {
      setIsConnected(true);
      const wasBannedOnConnect = moderationDisconnectRef.current === "ban";

      // ✅ ban 상태가 아닐 때만 connectionError 제거 (1일채팅금지는 유지)
      if (!wasBannedOnConnect) {
        setConnectionError(null);
        if (kickErrKey) localStorage.removeItem(kickErrKey);
        setBanInfo(null);
      }

      moderationDisconnectRef.current = wasBannedOnConnect ? "ban" : null;

      // 캐시 ban 복원 상태가 '기간제'인 경우에만 kickRejected 미수신 시 자동 해제 확인을 수행한다.
      // 영구 정지는 관리자 해제 전까지 절대 자동 해제하지 않는다.
      if (wasBannedOnConnect && !hasSavedPermanentBan) {
        pendingBanCheckRef.current = true; // 연결 직후 ban 확인 대기 중

        setTimeout(() => {
          // pendingBanCheckRef가 true인 채로 1500ms 지남 → kickRejected 안 옴 → 밴 해제된 것
          if (pendingBanCheckRef.current && newSocket.connected) {
            pendingBanCheckRef.current = false;
            moderationDisconnectRef.current = null;
            setBanInfo(null);
            const key = getBanInfoCacheKey();
            if (key) localStorage.removeItem(key);
          }
        }, 1500);
      }

      if (activeDmUserIdRef.current) {
        newSocket.emit("joinDmRoom", {
          targetUserId: String(activeDmUserIdRef.current),
        });
      }

      const knownThreadIds = dmThreadUserIdsRef.current.filter(Boolean);
      if (knownThreadIds.length > 0) {
        newSocket.emit("getDmThreadSummaries", {
          targetUserIds: knownThreadIds,
          lastReadByUser: dmReadStateByUserRef.current || {},
        });
      }
    });

    // 재연결/초기화 시 stale typing 사용자 목록 제거
    newSocket.on("disconnect", (reason) => {
      setTypingUsers([]);
      setDmTypingUsers([]);
      setIsConnected(false);
      if (reason === "io client disconnect") return;
      if (moderationDisconnectRef.current && reason === "io server disconnect")
        return;
      // 일반 네트워크 단절은 재로그인이 아니라 자동 재연결 대기 안내를 띄운다.
      setConnectionError(
        "연결이 일시적으로 끊겼습니다. 자동으로 다시 연결 중입니다...",
      );
    });

    newSocket.on("connect_error", (err) => {
      console.error("[Socket] 연결 실패:", err.message);
      setIsConnected(false);
      if (moderationDisconnectRef.current) return;
      setConnectionError("서버에 연결 중입니다. 잠시만 기다려 주세요...");
    });

    newSocket.on("reconnect_attempt", (attempt) => {
      if (moderationDisconnectRef.current) return;
      setConnectionError(`서버 재연결 시도 중입니다... (${attempt}회)`);
    });

    newSocket.on("reconnect_error", () => {
      if (moderationDisconnectRef.current) return;
      setConnectionError(
        "재연결 중입니다. 네트워크 상태를 확인하고 잠시만 기다려 주세요...",
      );
    });

    newSocket.on("reconnect_failed", () => {
      if (moderationDisconnectRef.current) return;
      setConnectionError(
        "자동 재연결에 실패했습니다. 잠시 후 다시 연결을 시도합니다...",
      );
    });

    newSocket.on("kickResult", (payload) => {
      if (!payload) return;
      if (payload.ok) {
        const target =
          payload.targetName || payload.targetUserId || "대상 사용자";
        const isPermanent = Boolean(payload?.isPermanent);
        const banSeconds = Number(payload?.banSeconds || 0);
        const actionLabel = isPermanent
          ? "영구 정지"
          : banSeconds > 0
            ? "1일 채팅 금지"
            : "강제 퇴장";
        toast.success(`${target} ${actionLabel} 처리 완료`);
        // 밴 처리 시 차단 목록 자동 갱신
        if (isPermanent || banSeconds > 0) {
          newSocket.emit("getBannedUsers");
        }
        return;
      }
      toast.error(payload.reason || "강퇴 처리에 실패했습니다.");
    });

    newSocket.on("userKicked", (payload) => {
      const reason = String(payload?.reason || "규칙 위반");
      const banSeconds = Number(payload?.banSeconds || 0);
      const isPermanent = Boolean(payload?.isPermanent);
      const byName = String(payload?.byName || "관리자");
      if (banSeconds > 0 || isPermanent) {
        moderationDisconnectRef.current = "ban";
        const newBanData = { reason, banSeconds, byName, isPermanent };
        setBanInfo(newBanData);

        // ✅ 1일 채팅금지도 connectionError로 저장해서 두 섹션에서 경고 표시
        let kickMessage;
        if (isPermanent) {
          kickMessage = `경고: 채팅이 영구 정지되었습니다.\n사유: ${reason}\n재접속해도 동일한 안내가 표시됩니다. 해제가 필요하면 관리자에게 문의해 주세요.`;
        } else {
          kickMessage = `경고: 1일간 채팅이 금지되었습니다.\n사유: ${reason}\n제한 시간이 끝나기 전에는 재접속해도 채팅이 제한됩니다. 필요하면 관리자에게 문의해 주세요.`;
        }
        setConnectionError(kickMessage);
        if (kickErrKey) localStorage.setItem(kickErrKey, kickMessage);
        setShowChat(true);

        // ✅ 영구 정지 & 1일 채팅금지 모두 localStorage에 영속화 (F5 후 즉시 복원용)
        if (isPermanent || banSeconds > 0) {
          const key = getBanInfoCacheKey();
          if (key) localStorage.setItem(key, JSON.stringify(newBanData));
        }
      } else {
        moderationDisconnectRef.current = "kick";
        const kickMessage = `경고: 강제 퇴장되었습니다. 사유: ${reason}\n재로그인이 필요합니다. 로그인 후 채팅을 다시 열어 접속해 주세요.`;
        setConnectionError(kickMessage);
        if (kickErrKey) localStorage.setItem(kickErrKey, kickMessage);
        resetDmRuntimeState();
        setShowChat(true);
      }
    });

    newSocket.on("kickRejected", (payload) => {
      // kickRejected 도착 → 아직 ban 중 → pendingBanCheck 해제 (setTimeout에서 ban 풀지 않도록)
      pendingBanCheckRef.current = false;

      const reason = String(payload?.reason || "규칙 위반");
      const ttlSeconds = Number(payload?.ttlSeconds || 0);
      const banSeconds = Number(payload?.banSeconds || 0);
      const isPermanent = Boolean(payload?.isPermanent);
      const mustRelogin = Boolean(payload?.mustRelogin);
      const byName = String(payload?.byName || "관리자");
      if (mustRelogin || (!isPermanent && banSeconds <= 0 && ttlSeconds <= 0)) {
        moderationDisconnectRef.current = "kick";
        setBanInfo(null);
        const kickMessage = `경고: ${reason}\n재로그인이 필요합니다. 로그인 후 다시 이용해 주세요.`;
        setConnectionError(kickMessage);
        if (kickErrKey) localStorage.setItem(kickErrKey, kickMessage);
        resetDmRuntimeState();
        setShowChat(true);
        return;
      }

      moderationDisconnectRef.current = "ban";
      const newBanData = {
        reason,
        ttlSeconds,
        banSeconds,
        byName,
        isPermanent,
      };
      setBanInfo(newBanData);

      // ✅ 1일 채팅금지도 connectionError로 저장해서 두 섹션에서 경고 표시
      let kickMessage;
      if (isPermanent) {
        kickMessage = `경고: 채팅이 영구 정지되었습니다.\n사유: ${reason}\n재접속해도 동일한 안내가 표시됩니다. 해제가 필요하면 관리자에게 문의해 주세요.`;
      } else {
        kickMessage = `경고: 1일간 채팅이 금지되었습니다.\n사유: ${reason}\n제한 시간이 끝나기 전에는 재접속해도 채팅이 제한됩니다. 필요하면 관리자에게 문의해 주세요.`;
      }
      setConnectionError(kickMessage);
      if (kickErrKey) localStorage.setItem(kickErrKey, kickMessage);
      setShowChat(true); // 채팅창 열어서 안내 표시

      // ✅ 영구 정지 & 1일 채팅금지 모두 localStorage에 영속화 (F5 후 즉시 복원용)
      if (isPermanent || banSeconds > 0) {
        const key = getBanInfoCacheKey();
        if (key) localStorage.setItem(key, JSON.stringify(newBanData));
      }
    });

    newSocket.on("unbanResult", (payload) => {
      if (payload?.ok) {
        const name = payload.targetName || payload.targetUserId || "사용자";
        toast.success(`${name} 차단이 해제되었습니다.`);
        // 목록 갱신
        newSocket.emit("getBannedUsers");
      } else {
        toast.error(payload?.reason || "차단 해제 실패");
      }
    });

    newSocket.on("bannedUsers", (list) => {
      setBannedUsers(Array.isArray(list) ? list : []);
    });

    // ✅ 대상 사용자가 unban되었을 때 (실시간 반영)
    newSocket.on("userUnbanned", (payload) => {
      const byName = String(payload?.byName || "관리자");
      setBanInfo(null);
      setConnectionError(null);
      if (kickErrKey) localStorage.removeItem(kickErrKey);
      const banCacheKey = getBanInfoCacheKey();
      if (banCacheKey) localStorage.removeItem(banCacheKey);
      moderationDisconnectRef.current = null;
      toast.success(`${byName}에 의해 제재 해제되었습니다.`);
    });

    // initMessages 이벤트 수정
    newSocket.on("initMessages", (pastMessages) => {
      console.log(
        `[WebSocketChat] initMessages 수신됨 (${pastMessages?.length || 0}개) → 공개채팅은 실시간 스트리밍형이므로 무시합니다.`,
      );

      // 공개채팅은 과거 히스토리를 로드하지 않음
      // F5 새로고침 시에만 sessionStorage에서 복원되도록 둡니다.
    });

    newSocket.on("receiveMessage", (payload) => {
      const msg = payload?.content ? payload : payload?.[0] || payload;
      const currentUserId =
        localStorage.getItem("userDbId") || localStorage.getItem("userId");
      const isMyMessage =
        String(msg.senderId || msg.sender || msg.userId) ===
        String(currentUserId);

      const safeMsg = {
        id: msg.id || `msg-${Date.now()}-${Math.random()}`, // 없으면 생성
        senderId: msg.senderId || msg.sender || msg.userId,
        senderName: msg.senderName || msg.name || msg.username || "",
        content: msg.content || msg.message || msg.text,
        timestamp: msg.timestamp || new Date().toISOString(),
        isSystem: msg.isSystem || false,
        // 채팅 탭을 실제로 보고 있을 때만 즉시 읽음 처리
        isRead:
          isMyMessage || (showChatRef.current && isViewingChatTabRef.current),
      };

      setMessages((prev) => {
        if (safeMsg.id && prev.some((existing) => existing.id === safeMsg.id)) {
          return prev;
        }
        const updated = [...prev, safeMsg];
        const key = getStorageKey();
        if (key) sessionStorage.setItem(key, JSON.stringify(updated)); // ← sessionStorage로 변경
        return updated;
      });

      // 메시지가 도착하면 해당 사용자의 입력 중 상태는 해제
      const sender = String(msg.senderId || msg.sender || msg.userId || "");
      if (sender) {
        setTypingUsers((prev) =>
          prev.filter((user) => String(user.userId) !== sender),
        );
      }
    });

    newSocket.on("onlineUsers", (users) => {
      setOnlineUsers(users || []);
    });

    newSocket.on("dmHistory", (payload) => {
      const roomId = String(payload?.roomId || "");
      const targetUserId = String(payload?.targetUserId || "");
      const history = Array.isArray(payload?.messages) ? payload.messages : [];

      const { value: persistedRoomValue } = readPersistedJson([
        getDmStorageKey(roomId),
        getLegacyDmStorageKey(roomId),
      ]);
      const persistedRoomMessages = Array.isArray(persistedRoomValue)
        ? persistedRoomValue
        : [];

      const normalized = history
        .map((msg) => ({
          ...msg,
          roomId,
          messageType: "dm",
          isRead: true,
        }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // 서버가 일시적으로 빈 히스토리를 반환해도 기존 캐시가 있으면 유지한다.
      const effectiveMessages =
        normalized.length === 0 && persistedRoomMessages.length > 0
          ? persistedRoomMessages
          : normalized;

      setDmRoomId(roomId);
      setDmMessages(effectiveMessages);
      if (targetUserId) {
        setActiveDmUserId(targetUserId);
        registerDmThreadUser(targetUserId);
        markDmThreadRead(
          targetUserId,
          effectiveMessages[effectiveMessages.length - 1]?.timestamp ||
            new Date().toISOString(),
        );
        if (effectiveMessages.length > 0) {
          updateDmLastPreview(
            targetUserId,
            effectiveMessages[effectiveMessages.length - 1],
            getKnownUserName(targetUserId),
          );
        }
      }

      if (normalized.length > 0) {
        persistDmRoomMessages(roomId, normalized);
      }
    });

    newSocket.on("receiveDmMessage", (payload) => {
      const msg = payload?.content ? payload : payload?.[0] || payload;
      const currentUserId = normalizeUserId(
        localStorage.getItem("userDbId") || localStorage.getItem("userId"),
      );
      const roomId = String(msg.roomId || "");
      const safeMsg = {
        id: msg.id || `dm-${Date.now()}-${Math.random()}`,
        roomId,
        senderId: String(msg.senderId || ""),
        senderName: msg.senderName || "",
        recipientId: String(msg.recipientId || ""),
        content: msg.content || msg.message || msg.text,
        timestamp: msg.timestamp || new Date().toISOString(),
        isSystem: Boolean(msg.isSystem),
        messageType: "dm",
      };

      // room broadcast + direct emit 동시 수신 시 중복 반영 방지
      if (safeMsg.id && processedDmMessageIdsRef.current.has(safeMsg.id)) {
        return;
      }
      if (safeMsg.id) {
        processedDmMessageIdsRef.current.add(safeMsg.id);
        if (processedDmMessageIdsRef.current.size > 2000) {
          const oldestId = processedDmMessageIdsRef.current
            .values()
            .next().value;
          if (oldestId) processedDmMessageIdsRef.current.delete(oldestId);
        }
      }

      const isMine = safeMsg.senderId === currentUserId;
      const partnerId = isMine ? safeMsg.recipientId : safeMsg.senderId;

      // 활성 DM 룸이 아니어도 room 캐시에 누적해 새로고침 복원 시 데이터 유실을 막는다.
      if (roomId) {
        const { value: persistedRoomValue } = readPersistedJson([
          getDmStorageKey(roomId),
          getLegacyDmStorageKey(roomId),
        ]);
        try {
          const prevList = Array.isArray(persistedRoomValue)
            ? persistedRoomValue
            : [];
          const base = Array.isArray(prevList) ? prevList : [];
          if (
            !base.some(
              (existing) => String(existing?.id) === String(safeMsg.id),
            )
          ) {
            const next = [...base, safeMsg].sort(
              (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
            );
            persistDmRoomMessages(roomId, next);
          }
        } catch (e) {
          console.error("[LocalStorage] DM room 캐시 저장 실패:", e);
        }
      }

      const activeRoom = dmRoomIdRef.current;
      const activeTarget = normalizeUserId(activeDmUserIdRef.current);
      const expectedActiveRoom = activeTarget
        ? buildDmRoomId(currentUserId, activeTarget)
        : "";
      const shouldAppendToActiveRoom =
        (Boolean(roomId) &&
          (roomId === activeRoom || roomId === expectedActiveRoom)) ||
        (Boolean(activeTarget) && partnerId === activeTarget);

      if (shouldAppendToActiveRoom) {
        setDmMessages((prev) => {
          if (prev.some((existing) => existing.id === safeMsg.id)) return prev;
          const updated = [...prev, safeMsg].sort(
            (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
          );
          const persistRoomId = roomId || expectedActiveRoom;
          persistDmRoomMessages(persistRoomId, updated);
          return updated;
        });
      }

      const isReadingCurrentRoom =
        showChatRef.current &&
        isViewingDmRoomRef.current &&
        activeRoom &&
        roomId === activeRoom;

      if (!isMine && partnerId && !isReadingCurrentRoom) {
        setDmUnreadByUserAndPersist((prev) => ({
          ...prev,
          [partnerId]: Number(prev[partnerId] || 0) + 1,
        }));
      } else if (!isMine && partnerId && isReadingCurrentRoom) {
        markDmThreadRead(
          partnerId,
          safeMsg.timestamp || new Date().toISOString(),
        );
      }

      if (partnerId) {
        const partnerName = isMine
          ? getKnownUserName(partnerId)
          : safeMsg.senderName || getKnownUserName(partnerId);
        registerDmThreadUser(partnerId);
        updateDmLastPreview(partnerId, safeMsg, partnerName);
      }
    });

    newSocket.on("dmTyping", (payload) => {
      const typingUserId = String(payload?.userId || "");
      const roomId = String(payload?.roomId || "");
      const isTyping = Boolean(payload?.isTyping);
      const typingName = payload?.name || typingUserId;
      const currentUserId = normalizeUserId(
        localStorage.getItem("userDbId") || localStorage.getItem("userId"),
      );
      const activeTarget = normalizeUserId(activeDmUserIdRef.current);
      const expectedRoomId = activeTarget
        ? buildDmRoomId(currentUserId, activeTarget)
        : "";
      const isActiveTargetTyping = Boolean(
        activeTarget && typingUserId === activeTarget,
      );

      if (!typingUserId || typingUserId === currentUserId) return;
      if (
        !isActiveTargetTyping &&
        roomId !== dmRoomIdRef.current &&
        roomId !== expectedRoomId
      ) {
        return;
      }

      const timerKey = `${roomId}:${typingUserId}`;
      const currentTimer = dmTypingUserTimersRef.current.get(timerKey);
      if (currentTimer) clearTimeout(currentTimer);

      if (!isTyping) {
        setDmTypingUsers((prev) =>
          prev.filter((user) => String(user.userId) !== typingUserId),
        );
        dmTypingUserTimersRef.current.delete(timerKey);
        return;
      }

      setDmTypingUsers((prev) => {
        const filtered = prev.filter(
          (user) => String(user.userId) !== typingUserId,
        );
        return [...filtered, { userId: typingUserId, name: typingName }];
      });

      const timeoutId = setTimeout(() => {
        setDmTypingUsers((prev) =>
          prev.filter((user) => String(user.userId) !== typingUserId),
        );
        dmTypingUserTimersRef.current.delete(timerKey);
      }, 5000);

      dmTypingUserTimersRef.current.set(timerKey, timeoutId);
    });

    newSocket.on("dmThreadSummaries", (payload) => {
      const summaries = Array.isArray(payload?.summaries)
        ? payload.summaries
        : [];
      if (!summaries.length) return;
      setDmUserNamesById((prev) => {
        const updated = { ...prev };
        summaries.forEach((item) => {
          const targetId = normalizeUserId(item?.targetUserId);
          const targetName = String(item?.targetUserName || "").trim();
          if (targetId && targetName) {
            updated[targetId] = targetName;
          }
        });
        return updated;
      });

      setDmLastByUser((prev) => {
        const updated = { ...prev };
        summaries.forEach((item) => {
          const targetId = normalizeUserId(item?.targetUserId);
          const latest = item?.latestMessage;
          // 삭제된 스레드는 서버 응답으로 재추가하지 않음
          if (!targetId || !latest || !(targetId in prev)) return;

          updated[targetId] = {
            preview: latest.content || latest.message || latest.text || "",
            timestamp: latest.timestamp || new Date().toISOString(),
            senderName:
              latest.senderName ||
              String(item?.targetUserName || "").trim() ||
              updated[targetId]?.senderName ||
              "",
          };
        });
        return updated;
      });

      setDmUnreadByUserAndPersist((prev) => {
        const updated = { ...prev };
        summaries.forEach((item) => {
          const targetId = normalizeUserId(item?.targetUserId);
          // 삭제된 스레드는 서버 응답으로 재추가하지 않음
          if (!targetId || !(targetId in prev)) return;
          updated[targetId] = Number(item?.unreadCount || 0);
        });
        return updated;
      });
    });

    // ==================== Typing Indicator 수신 ====================
    newSocket.on("typing", (payload) => {
      const typingUserId = String(payload?.userId || "");
      if (!typingUserId || typingUserId === String(userDbId)) return;

      const typingName = payload?.name || typingUserId;
      const isTyping = Boolean(payload?.isTyping);

      const currentTimer = typingUserTimersRef.current.get(typingUserId);
      if (currentTimer) clearTimeout(currentTimer);

      if (!isTyping) {
        setTypingUsers((prev) =>
          prev.filter((user) => String(user.userId) !== typingUserId),
        );
        typingUserTimersRef.current.delete(typingUserId);
        return;
      }

      setTypingUsers((prev) => {
        const filtered = prev.filter(
          (user) => String(user.userId) !== typingUserId,
        );
        return [...filtered, { userId: typingUserId, name: typingName }];
      });

      // stop 이벤트 누락 대비: 5초 후 자동 해제
      const timeoutId = setTimeout(() => {
        setTypingUsers((prev) =>
          prev.filter((user) => String(user.userId) !== typingUserId),
        );
        typingUserTimersRef.current.delete(typingUserId);
      }, 5000);

      typingUserTimersRef.current.set(typingUserId, timeoutId);
    });

    setSocket(newSocket);

    return () => {
      typingUserTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      typingUserTimersRef.current.clear();
      dmTypingUserTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      dmTypingUserTimersRef.current.clear();
      newSocket.disconnect();
    };
  }, [hasAuthSession, sessionToken, userDbId, resetDmRuntimeState]);

  useWebSocketChatHydration({
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
  });

  useWebSocketChatPostEffects({
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
    setMessagesForRead: setMessages,
    messages,
    setUnreadCountFromMessages: setUnreadCount,
    getStorageKey,
    getDmMetaStorageKey,
    dmThreadUserIds,
    dmLastByUser,
    dmUnreadByUser,
    dmUserNamesById,
    dmReadStateByUser,
    isConnected,
    socket,
  });

  const dmUnreadTotal = Object.values(dmUnreadByUser).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const totalUnreadCount = unreadCount + dmUnreadTotal;

  const {
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
  } = useMemo(
    () =>
      createWebSocketChatHandlers({
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
        storage: sessionStorage, // 공개채팅 메시지는 sessionStorage 사용
      }),
    [
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
      setDmUnreadByUserAndPersist,
      setDmReadStateByUserAndPersist,
    ],
  );

  if (!hasAuthSession) return null;

  return (
    <>
      <button
        ref={chatButtonRef}
        className="floating-chat-btn relative"
        onClick={() => setShowChat((prev) => !prev)}
        title="실시간 채팅 열기"
      >
        💬
        {totalUnreadCount > 0 && (
          <span key={`unread-${totalUnreadCount}`} className="unread-badge">
            {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
          </span>
        )}
      </button>

      {showChat && (
        <div ref={chatPanelRef} className="floating-chat-panel">
          <WebSocketChatWindow
            messages={messages}
            dmMessages={dmMessages}
            onSend={handleSendMessage}
            onSendDm={handleSendDmMessage}
            onOpenDm={handleOpenDm}
            isConnected={isConnected}
            onlineUsers={onlineUsers}
            activeDmUserId={activeDmUserId}
            chatUnreadCount={unreadCount}
            dmUnreadByUser={dmUnreadByUser}
            dmUnreadTotal={dmUnreadTotal}
            dmThreadUserIds={dmThreadUserIds}
            dmLastByUser={dmLastByUser}
            dmUserNamesById={dmUserNamesById}
            connectionError={connectionError}
            isOpen={showChat}
            typingUsers={typingUsers}
            dmTypingUsers={dmTypingUsers}
            onTypingChange={handleTypingChange}
            onDmTypingChange={handleDmTypingChange}
            onDeleteDmThread={handleDeleteDmThread}
            onKickUser={handleKickUser}
            onUnbanUser={handleUnbanUser}
            onGetBannedUsers={handleGetBannedUsers}
            banInfo={banInfo}
            bannedUsers={bannedUsers}
            onCloseDmRoom={handleCloseDmRoom}
            onDmViewStateChange={setIsViewingDmRoom}
            onChatViewStateChange={setIsViewingChatTab}
            onClose={() => setShowChat(false)}
          />
        </div>
      )}
    </>
  );
}