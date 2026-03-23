// src/components/WebSocketChat.jsx
import React, { useState, useEffect } from "react";
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

  const userId = localStorage.getItem("userId");
  const sessionToken = localStorage.getItem("session_token");
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";

  // localStorage 키 생성 함수 → 여기로 이동 (최상단 선언)
  const getStorageKey = () =>
    userId && sessionToken
      ? `chat_messages_user_${userId}_sess_${sessionToken.slice(-12)}`
      : null;

  // ==================== 로그인 직후 백그라운드 연결 (핵심) ====================
  useEffect(() => {
    if (!isLoggedIn || !sessionToken || !userId) {
      if (socket) socket.disconnect();
      setMessages([]);
      setUnreadCount(0);
      setOnlineUsers([]);
      setIsConnected(false);
      return;
    }

    const newSocket = io("/", {
      path: "/socket.io/",
      transports: ["websocket", "polling"], // websocket을 먼저 시도하도록 순서 변경
      upgrade: true,
      forceNew: false,
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 15000,
      timeout: 45000,
      auth: { session_token: sessionToken },
      withCredentials: true, // 쿠키/인증 헤더 전달 보장
    });

    newSocket.on("connect", () => {
      console.log("[Background Socket] 연결 성공!");

      newSocket.emit("authenticate", {
        session_token: sessionToken,
      });
      setIsConnected(true);
    });

    newSocket.on("connect_error", (err) => {
      console.error("[Socket] 연결 실패:", err.message);
      setConnectionError(err.message);
      setIsConnected(false);
    });

    // 과거 메시지 초기 로드 (재접속/첫 접속 시)
    newSocket.on("initMessages", (pastMessages) => {
      if (Array.isArray(pastMessages) && pastMessages.length > 0) {
        setMessages(pastMessages);
        const key = getStorageKey();
        if (key) localStorage.setItem(key, JSON.stringify(pastMessages));
        console.log(`[Socket] 과거 메시지 ${pastMessages.length}개 로드`);
      }
    });

    // 실시간 메시지 수신
    newSocket.on("receiveMessage", (msg) => {
      console.log("🔥 메시지 받음:", msg);

      // 🔥 여기 추가 (핵심)
      const safeMsg = {
        ...msg,
        timestamp: msg.timestamp || new Date().toISOString(),
      };

      setMessages((prev) => {
        const updated = [...prev, safeMsg].slice(-1000);
        const key = getStorageKey();

        if (key) localStorage.setItem(key, JSON.stringify(updated));
        return updated;
      });

      // 내가 보낸 메시지가 아니고, 시스템 메시지도 아니면 unread 증가
      if (msg.senderId !== userId && !msg.isSystem) {
        // 채팅창이 열려있지 않을 때만 카운트 증가 (중요!)
        if (!showChat) {
          setUnreadCount((prev) => prev + 1);
        }
      }
    });

    // 온라인 유저 목록 실시간 업데이트
    newSocket.on("onlineUsers", (users) => {
      setOnlineUsers(users || []);
    });

    newSocket.on("connect_error", (err) => {
      console.error("[Background Socket] 연결 실패:", err.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isLoggedIn, sessionToken, userId]);
  // =====================================================================

  // F5 새로고침 시 localStorage 복구 (initMessages가 없으면 이걸로 fallback)
  useEffect(() => {
    if (!isLoggedIn || !userId || !sessionToken) return;

    const key = getStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      } catch (e) {
        console.error("[LocalStorage] 메시지 파싱 실패:", e);
      }
    }
  }, [isLoggedIn, userId, sessionToken]);

  // 로그아웃 시 정리
  useEffect(() => {
    if (!isLoggedIn) {
      const key = getStorageKey();
      if (key) localStorage.removeItem(key);
      setMessages([]);
      setUnreadCount(0);
      setOnlineUsers([]);
    }
  }, [isLoggedIn]);

  const handleSendMessage = (text) => {
    if (!text?.trim()) return false;
    console.log("[Chat] 메시지 전송 시도:", text);
    const success = socket?.emit("sendMessage", { content: text });
    console.log(
      "[Chat] emit 결과:",
      success ? "성공" : "실패 - 소켓 연결 상태:",
      socket?.connected,
    );
    return success;
  };

  // 채팅창 열릴 때 unread 초기화
  useEffect(() => {
    if (showChat) {
      setUnreadCount(0);
    }
  }, [showChat]);

  if (!isLoggedIn) return null;

  return (
    <>
      {/* 플로팅 버튼 - 항상 보임 + unread 실시간 */}
      <button
        className="floating-chat-btn relative"
        onClick={() => setShowChat((prev) => !prev)}
        title="실시간 채팅 열기"
      >
        💬
        {unreadCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-md border-2 border-white animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* 채팅 패널 */}
      {showChat && (
        <div className="floating-chat-panel">
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
              onUnreadCountChange={setUnreadCount}
            />
          </div>
        </div>
      )}
    </>
  );
}

// 원본 샘플
//   {/* ← 여기로 Floating Chat 옮김 */}
//   <button
//     className="floating-chat-btn"
//     onClick={() => setShowChat(!showChat)}
//     title="실시간 채팅 열기"
//   >
//     💬
//   </button>

//   {showChat && (
//     <div className="floating-chat-panel">
//       <div className="chat-header">
//         <h3>실시간 채팅</h3>
//         <button onClick={() => setShowChat(false)}>✕</button>
//       </div>
//       <div className="chat-body">
//         <WebSocketChatWindow />
//       </div>
//     </div>
//   )}
