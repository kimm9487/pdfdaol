// src/components/WebSocketChatWindow.jsx
import { useState, useEffect, useRef, useMemo } from "react";
import ChatHeader from "./WebSocketChatHeader";
import MessageList from "./WebSocketMessageList";
import ChatInput from "./WebSocketChatInput";

const getChatStorageKey = () => {
  const userId = localStorage.getItem("userId");
  const sessionToken = localStorage.getItem("session_token");
  if (!userId || !sessionToken) return null;
  return `chat_messages_user_${userId}_sess_${sessionToken.slice(-12)}`;
};

// ★ 전체 문자열 해시 — 같은 색 방지
const hashUserId = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
};

const AVATAR_COLORS = [
  "#4f91f6",
  "#7c6cf8",
  "#e85d75",
  "#34d399",
  "#f59e0b",
  "#06b6d4",
  "#a78bfa",
  "#fb923c",
  "#38bdf8",
  "#4ade80",
  "#e879f9",
  "#f472b6",
  "#22d3ee",
  "#84cc16",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#10b981",
];

export default function WebSocketChatWindow({
  messages = [],
  onSend,
  isConnected = false,
  onlineUsers = [],
  connectionError = null,
  onUnreadCountChange,
}) {
  const bottomRef = useRef(null);

  const [lastViewedAt, setLastViewedAt] = useState(() => {
    const saved = localStorage.getItem("chat_last_viewed");
    return saved ? Number(saved) : Date.now();
  });

  const userId = localStorage.getItem("userId");

  const unreadCount = useMemo(() => {
    if (!lastViewedAt) return messages.length;
    return messages.filter((m) => {
      if (m.isSystem) return false;
      if (m.senderId === userId) return false;
      return new Date(m.timestamp).getTime() > lastViewedAt;
    }).length;
  }, [messages, lastViewedAt, userId]);

  useEffect(() => {
    if (typeof onUnreadCountChange === "function") {
      onUnreadCountChange(unreadCount);
    }
  }, [unreadCount, onUnreadCountChange]);

  useEffect(() => {
    if (messages.length > 0) {
      const now = Date.now();
      localStorage.setItem("chat_last_viewed", now.toString());
      setLastViewedAt(now);
    }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = (text) => {
    if (!text.trim()) return false;
    return onSend(text);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 relative">
      <ChatHeader isConnected={isConnected} onlineCount={onlineUsers.length} />

      {connectionError && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 m-4 rounded">
          연결 오류: {connectionError}
        </div>
      )}

      {onlineUsers.length > 0 && (
        <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-sm border-b">
          {onlineUsers.map((u, i) => {
            const uid = u.userId || u.id || u.name || "";
            const initials = uid.slice(0, 2).toUpperCase();
            // ★ charCodeAt(0) → hashUserId(전체문자열) 로 변경
            const color = AVATAR_COLORS[hashUserId(uid) % AVATAR_COLORS.length];

            return (
              <div
                key={uid || i}
                className="online-user-avatar"
                title={`${u.name} (${uid})`}
                style={{ background: color }}
              >
                {initials}
              </div>
            );
          })}
        </div>
      )}

      <MessageList messages={messages} bottomRef={bottomRef} />
      <ChatInput onSend={handleSendMessage} disabled={!isConnected} />
    </div>
  );
}
