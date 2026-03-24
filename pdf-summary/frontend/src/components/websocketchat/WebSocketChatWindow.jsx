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
  typingUsers = [],
  onTypingChange,
}) {
  const bottomRef = useRef(null);
  const userNameById = Object.fromEntries(
    onlineUsers.map((user) => [String(user.userId || user.id || ""), user.name || ""])
  );
  const decoratedMessages = messages.map((message) => ({
    ...message,
    senderName: userNameById[String(message.senderId)] || message.senderName || "",
  }));

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

  const typingText = (() => {
    if (!typingUsers.length) return "";
    if (typingUsers.length === 1) {
      const first = typingUsers[0].name || typingUsers[0].userId;
      return `${first} 입력중입니다`;
    }
    const first = typingUsers[0].name || typingUsers[0].userId;
    return `${first} 외 ${typingUsers.length - 1}명 입력중입니다`;
  })();

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 relative">
      <ChatHeader isConnected={isConnected} onlineCount={onlineUsers.length} />

      {onlineUsers.length > 0 && (
        <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-sm border-b flex gap-2 overflow-x-auto pb-3">
          {onlineUsers.map((u, i) => {
            const uid = u.userId || u.id || "";
            const initials = (u.name || uid).slice(0, 2).toUpperCase(); // admin→AD, wjdwogns→WJ
            const color = AVATAR_COLORS[hashUserId(uid) % AVATAR_COLORS.length];

            return (
              <div
                key={uid || i}
                className="online-user-avatar"
                title={u.name || initials}
                style={{ background: color }}
              >
                {initials}
              </div>
            );
          })}
        </div>
      )}

      <MessageList messages={decoratedMessages} bottomRef={bottomRef} />

      <div className="chat-input-zone">
        <ChatInput
          onSend={handleSendMessage}
          disabled={!isConnected}
          onTypingChange={onTypingChange}
        />

        {/* 실시간 입력 중 표시: 입력창 하단 */}
        {typingUsers.length > 0 && (
          <div className="chat-typing-indicator is-visible" aria-live="polite">
            <span className="chat-typing-text">{typingText}</span>
            <span className="chat-typing-ellipsis" aria-hidden="true">...</span>
          </div>
        )}

        {connectionError && (
          <div className="chat-input-error" role="alert" aria-live="polite">
            연결 오류: {connectionError}
          </div>
        )}
      </div>
    </div>
  );
}