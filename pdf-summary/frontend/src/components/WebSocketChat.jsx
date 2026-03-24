/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from "react";
import WebSocketChatWindow from "./websocketchat/WebSocketChatWindow";
import "./websocketchat/WebSocketChat.css";
import { io } from "socket.io-client";

export default function WebSocketChat() {
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [connectionError, setConnectionError] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);

  // 플로팅 패널 외부 클릭 감지를 위한 ref
  const chatPanelRef = useRef(null);
  const chatButtonRef = useRef(null);

  // 입력 중 이벤트 트래픽 완화를 위한 heartbeat/만료 ref
  const typingHeartbeatRef = useRef(0);
  const typingUserTimersRef = useRef(new Map());
  const showChatRef = useRef(false);

  const userId = localStorage.getItem("userId");
  const userDbId = localStorage.getItem("userDbId") || userId;
  const sessionToken = localStorage.getItem("session_token");
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";

  const getStorageKey = () =>
    userDbId && sessionToken
      ? `chat_messages_user_${userDbId}_sess_${sessionToken.slice(-12)}`
      : null;

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

  // ==================== 로그인 직후 백그라운드 연결 ====================
  useEffect(() => {
    if (!isLoggedIn || !sessionToken || !userDbId) {
      if (socket) socket.disconnect();
      setMessages([]);
      setUnreadCount(0);
      setOnlineUsers([]);
      setIsConnected(false);
      return;
    }

    // ✅ 런타임 동적 WebSocket URL 결정 (yml 수정 불필요)
    // 1. localStorage에 저장된 백엔드 주소 우선
    // 2. 없으면 현재 페이지 origin 사용
    const getSocketUrl = () => {
      const stored = localStorage.getItem('backendSocketUrl');
      if (stored) {
        console.log("[Socket] localStorage에서 URL 로드:", stored);
        return stored;
      }
      console.log("[Socket] localStorage 없음 → window.location.origin 사용");
      return window.location.origin;
    };
    
    // ✅ 프로토콜 선택 (https → wss, http → ws)
    let url = getSocketUrl();
    if (window.location.protocol === 'https:') {
      url = url.replace(/^http:/, 'https:');
    }
    
    const socketUrl = url;
    
    // Socket.IO 연결 (✅ reconnection 강화)
    const newSocket = io(socketUrl, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20,              // ← 20번 시도 (이전: 5)
      reconnectionDelay: 1000,               // ← 1초 시작
      reconnectionDelayMax: 10000,           // ← 최대 10초
      timeout: 20000,
      auth: { session_token: sessionToken },
      withCredentials: true,
    });

    console.log("[Socket] 연결 시도:", socketUrl + "/socket.io");

    newSocket.on("connect", () => {
      console.log("[Background Socket] 연결 성공!");
      setIsConnected(true);
      // 재연결 성공 시 오류 문구 제거
      setConnectionError(null);
    });

    // 재연결/초기화 시 stale typing 사용자 목록 제거
    newSocket.on("disconnect", (reason) => {
      setTypingUsers([]);
      setIsConnected(false);
      if (reason === "io client disconnect") return;
      // 연결이 끊긴 상태를 사용자에게 명확히 안내
      setConnectionError("웹소켓 연결이 끊겼습니다. 재연결을 시도합니다.");
    });

    newSocket.on("connect_error", (err) => {
      console.error("[Socket] 연결 실패:", err.message);
      setIsConnected(false);
      setConnectionError("웹소켓 연결이 끊겼습니다. 재연결을 시도합니다.");
    });

    newSocket.on("initMessages", (pastMessages) => {
      if (Array.isArray(pastMessages) && pastMessages.length > 0) {
        // ✅ 개선: 기존 메시지와 병합 (ID 기반 중복 제거)
        const newMessages = pastMessages.filter(
          msg => !messages.some(existing => existing.id === msg.id)
        );
        
        const merged = [
          ...messages,
          ...newMessages.map(msg => ({
            ...msg,
            isRead: false  // 과거 메시지는 읽지 않음
          }))
        ].sort((a, b) => 
          new Date(a.timestamp) - new Date(b.timestamp)
        );
        
        // 중복 제거 (ID 기준)
        const unique = Array.from(
          new Map(merged.map(msg => [msg.id, msg])).values()
        );
        
        setMessages(unique);
        const key = getStorageKey();
        if (key) localStorage.setItem(key, JSON.stringify(unique));
        
        console.log(`[Socket] initMessages 수신: 신규 ${newMessages.length}개 병합, 총 ${unique.length}개`);
      }
    });

    newSocket.on("receiveMessage", (payload) => {
      const msg = payload?.content ? payload : payload?.[0] || payload;
      const currentUserId = localStorage.getItem("userDbId") || localStorage.getItem("userId");
      const isMyMessage = String(msg.senderId || msg.sender || msg.userId) === String(currentUserId);
      
      // ✅ 개선: ID 기반 중복 확인
      const isDuplicate = messages.some(existing => existing.id === msg.id);
      if (isDuplicate) {
        console.log(`[Socket] 중복 메시지 무시: ${msg.id}`);
        return;
      }
      
      const safeMsg = {
        id: msg.id || `msg-${Date.now()}-${Math.random()}`,  // 없으면 생성
        senderId: msg.senderId || msg.sender || msg.userId,
        senderName: msg.senderName || msg.name || msg.username || "",
        content: msg.content || msg.message || msg.text,
        timestamp: msg.timestamp || new Date().toISOString(),
        isSystem: msg.isSystem || false,
        // 채팅창이 열려 있으면 상대 메시지도 즉시 읽음 처리
        isRead: isMyMessage || showChatRef.current,
      };
      
      setMessages((prev) => {
        const updated = [...prev, safeMsg];
        const key = getStorageKey();
        if (key) localStorage.setItem(key, JSON.stringify(updated));
        return updated;
      });

      // 메시지가 도착하면 해당 사용자의 입력 중 상태는 해제
      const sender = String(msg.senderId || msg.sender || msg.userId || "");
      if (sender) {
        setTypingUsers((prev) => prev.filter((user) => String(user.userId) !== sender));
      }
    });

    newSocket.on("onlineUsers", (users) => {
      setOnlineUsers(users || []);
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
        setTypingUsers((prev) => prev.filter((user) => String(user.userId) !== typingUserId));
        typingUserTimersRef.current.delete(typingUserId);
        return;
      }

      setTypingUsers((prev) => {
        const filtered = prev.filter((user) => String(user.userId) !== typingUserId);
        return [...filtered, { userId: typingUserId, name: typingName }];
      });

      // stop 이벤트 누락 대비: 5초 후 자동 해제
      const timeoutId = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((user) => String(user.userId) !== typingUserId));
        typingUserTimersRef.current.delete(typingUserId);
      }, 5000);

      typingUserTimersRef.current.set(typingUserId, timeoutId);
    });

    setSocket(newSocket);

    return () => {
      typingUserTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      typingUserTimersRef.current.clear();
      newSocket.disconnect();
    };
  }, [isLoggedIn, sessionToken, userDbId]);

  // F5 새로고침 시 localStorage 복구
  useEffect(() => {
    if (!isLoggedIn || !userDbId || !sessionToken) return;
    const key = getStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed);
      } catch (e) {
        console.error("[LocalStorage] 메시지 파싱 실패:", e);
      }
    }
  }, [isLoggedIn, userDbId, sessionToken]);

  // 로그아웃 시 정리
  useEffect(() => {
    if (!isLoggedIn) {
      // 세션 토큰이 이미 제거된 경우에도 사용자 채팅 캐시를 확실히 정리
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
      setUnreadCount(0);
      setOnlineUsers([]);
    }
  }, [isLoggedIn, userDbId, userId]);

  // ==================== 안 읽은 배지 로직 (카톡처럼) ====================
  // 채팅창 열 때: 모든 메시지를 읽음으로 표시
  useEffect(() => {
    if (showChat) {
      setMessages((prev) =>
        prev.map((msg) => ({ ...msg, isRead: true }))
      );
      setUnreadCount(0);
    }
  }, [showChat]);

  // 메시지 변경 시: 읽지 않은 메시지 개수 계산
  useEffect(() => {
    if (!showChat) {
      // 채팅창이 닫혀 있을 때만 안읽음 카운트 계산
      const count = messages.filter(
        (msg) => !msg.isSystem && !msg.isRead
      ).length;
      setUnreadCount(count);
    }
  }, [messages, showChat]);

  const handleSendMessage = (text) => {
    if (!text?.trim() || !socket?.connected) return false;
    socket.emit("sendMessage", {
      content: text,
      userId: userDbId,
    });

    // 전송 직후 입력 중 상태 종료 알림
    socket.emit("typing", {
      userId: userDbId,
      isTyping: false,
    });
    typingHeartbeatRef.current = 0;
    return true;
  };

  // ==================== Typing Indicator 송신 ====================
  const handleTypingChange = (value) => {
    if (!socket?.connected || !userDbId) return;

    const hasValue = Boolean(value?.trim());
    const now = Date.now();

    if (!hasValue) {
      socket.emit("typing", { userId: userDbId, isTyping: false });
      typingHeartbeatRef.current = 0;
      return;
    }

    // 키 입력마다 전송하지 않고 heartbeat 형태로 제한
    if (now - typingHeartbeatRef.current > 2000) {
      socket.emit("typing", { userId: userDbId, isTyping: true });
      typingHeartbeatRef.current = now;
    }
  };

  if (!isLoggedIn) return null;

  return (
    <>
      <button
        ref={chatButtonRef}
        className="floating-chat-btn relative"
        onClick={() => setShowChat((prev) => !prev)}
        title="실시간 채팅 열기"
      >
        💬
        {unreadCount > 0 && (
          <span
            key={`unread-${unreadCount}`}
            className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-md border-2 border-white animate-pulse"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {showChat && (
        <div ref={chatPanelRef} className="floating-chat-panel">
          <div className="chat-header">
            <h3>실시간 채팅</h3>
            <button onClick={() => setShowChat(false)}>✕</button>
          </div>

          <div className="chat-body">
            <WebSocketChatWindow
              messages={messages}
              onSend={handleSendMessage}
              isConnected={isConnected}
              onlineUsers={onlineUsers}
              connectionError={connectionError}
              isOpen={showChat}
              typingUsers={typingUsers}
              onTypingChange={handleTypingChange}
            />
          </div>
        </div>
      )}
    </>
  );
}
