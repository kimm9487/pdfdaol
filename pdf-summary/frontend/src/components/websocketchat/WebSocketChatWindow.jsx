/* eslint-disable no-unused-vars */
import { useEffect, useRef } from "react";
import ChatHeader from "./WebSocketChatHeader";
import MessageList from "./WebSocketMessageList";
import ChatInput from "./WebSocketChatInput";

const hashUserId = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
};

const AVATAR_COLORS = [
  "#4f91f6", "#7c6cf8", "#e85d75", "#34d399", "#f59e0b", "#06b6d4", "#a78bfa",
  "#fb923c", "#38bdf8", "#4ade80", "#e879f9", "#f472b6", "#22d3ee", "#84cc16",
  "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#6366f1", "#10b981",
];

export default function WebSocketChatWindow({
  messages = [],
  onSend,
  isConnected = false,
  onlineUsers = [],
  connectionError = null,
  isOpen = false,
}) {
  const bottomRef = useRef(null);
  const userId = localStorage.getItem("userId");

  // 자동 스크롤
  useEffect(() => {
    if (bottomRef.current && isOpen) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSendMessage = (text) => {
    if (!text?.trim()) return false;
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
        <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-sm border-b flex gap-2 overflow-x-auto pb-3">
          {onlineUsers.map((u, i) => {
            const uid = u.userId || u.id || u.name || "";
            const initials = uid.slice(0, 2).toUpperCase();
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