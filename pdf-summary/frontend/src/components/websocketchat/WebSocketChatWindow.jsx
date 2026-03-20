// src/components/WebSocketChatWindow.jsx
import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import ChatHeader from "./WebSocketChatHeader";
import MessageList from "./WebSocketMessageList";
import ChatInput from "./WebSocketChatInput";

// ★★★ 세션별 localStorage 키 생성 (가장 중요한 변경점)
const getChatStorageKey = () => {
  const userId = localStorage.getItem("userId");
  const sessionToken = localStorage.getItem("session_token");
  if (!userId || !sessionToken) return null;

  // session_token으로 세션 구분 → 새 로그인 시 키가 달라져서 과거 기록 안 불러옴
  return `chat_messages_user_${userId}_sess_${sessionToken.slice(-12)}`;
};

export default function WebSocketChatWindow() {
  const bottomRef = useRef(null);

  // 세션별 키로 복구 → 새 로그인 = [] , 새로고침 = 이전 메시지 유지
  const [messages, setMessages] = useState(() => {
    const key = getChatStorageKey();
    if (!key) return [];
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("localStorage 복구 실패:", e);
      return [];
    }
  });

  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [connectionError, setConnectionError] = useState(null);

  const sessionToken = localStorage.getItem("session_token");
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
  const userId = localStorage.getItem("userId");

  // 메시지 변경 시 세션별로 저장 (새로고침해도 유지됨)
  useEffect(() => {
    const key = getChatStorageKey();
    if (key) {
      try {
        if (messages.length > 0) {
          localStorage.setItem(key, JSON.stringify(messages));
        } else {
          localStorage.removeItem(key);
        }
      } catch (e) {
        console.warn("localStorage 저장 실패:", e);
      }
    }
  }, [messages]);

  useEffect(() => {
    // 비로그인 상태 → 초기화
    if (!isLoggedIn || !sessionToken) {
      const key = getChatStorageKey();
      if (key) localStorage.removeItem(key);
      setMessages([]);
      setOnlineUsers([]);
      setIsConnected(false);
      setConnectionError("로그인이 필요합니다.");
      if (socket) socket.disconnect();
      return;
    }

    console.log("[Socket] 연결 시도 → username:", userId);

    // const backendUrl = import.meta.env.MODE === "development"
    //   ? ""
    //   : "https://your-production-domain.com";

    const newSocket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1500,
      auth: { session_token: sessionToken },
      withCredentials: true,
    });

    newSocket.on("connect", () => {
      console.log("[Socket] 연결 성공!");
      setIsConnected(true);
      setConnectionError(null);
      // ★★★ 여기서 setMessages([]) 하지 않음 → 세션 저장된 메시지 그대로 유지
    });

    // 과거 히스토리 이벤트는 완전 제거 (이미 백엔드에서도 안 보냄)
    // newSocket.on("initMessages", ... ) ← 삭제

    newSocket.on("receiveMessage", (msg) => {
      setMessages((prev) => {
        const updated = [...prev, msg];
        if (updated.length > 300) return updated.slice(-300);
        return updated;
      });
    });

    newSocket.on("onlineUsers", (users) => {
      setOnlineUsers(users || []);
    });

    newSocket.on("connect_error", (err) => {
      console.error("[Socket] 연결 실패:", err.message);
      setConnectionError(err.message);
      setIsConnected(false);
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [sessionToken, isLoggedIn]);

  // 스크롤 자동 이동
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (text) => {
    if (!socket || !isConnected || !text.trim()) return false;
    socket.emit("sendMessage", { content: text });
    return true;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 relative">
      <ChatHeader isConnected={isConnected} />

      {connectionError && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 m-4 rounded">
          연결 오류: {connectionError}
        </div>
      )}

      {onlineUsers.length > 0 && (
        <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-sm border-b">
          온라인 ({onlineUsers.length}명):{" "}
          {onlineUsers.map((u) => u.name).join(", ")}
        </div>
      )}

      <MessageList messages={messages} bottomRef={bottomRef} />
      <ChatInput onSend={handleSendMessage} disabled={!isConnected} />
    </div>
  );
}
