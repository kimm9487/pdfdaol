// src/components/websocketchat/WebSocketMessageItem.jsx
import { format } from "date-fns";

export default function MessageBubble({ message }) {
  const {
    senderId,
    senderName,
    content,
    timestamp,
    isSystem,
    isContinuous = false,
    showSenderInfo = true,
    status,
    isRead = true, // ← 추가
  } = message || {};

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <span className="px-4 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs rounded-full">
          {content}
        </span>
      </div>
    );
  }

  const currentUserId = localStorage.getItem("userDbId") || localStorage.getItem("userId");
  const isMe = String(senderId) === String(currentUserId);
  const timeStr = timestamp ? format(new Date(timestamp), "HH:mm:ss") : "";
  const rawLabel = (senderName || "").slice(0, 2).toUpperCase();
  const avatarLabel = rawLabel && !/^\d+$/.test(rawLabel) ? rawLabel : "?";
  const senderDisplayName = senderName && !/^\d+$/.test(senderName) ? senderName : "알 수 없음";

  return (
    <div
      className={`chat-msg-row flex items-end gap-2 group ${
        isMe ? "chat-msg-me" : "chat-msg-other"
      } ${
        isMe ? "justify-end" : "justify-start"
      } ${isContinuous ? "mt-0.5" : "mt-4"}`}
    >
      {/* 상대방 메시지일 때: 왼쪽에 아바타 */}
      {!isMe && showSenderInfo && (
        <div className="flex-shrink-0">
          {/* 여기에 실제 프로필 사진 넣기 (나중엔 백엔드에서 photoUrl 받아오면 좋음) */}
          <div
            className="w-9 h-9 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white text-sm font-medium"
            title={senderDisplayName}
          >
            {avatarLabel}
          </div>
        </div>
      )}

      {/* 연속 메시지면 아바타 공간만큼 패딩 유지 */}
      {!isMe && !showSenderInfo && <div className="w-9 flex-shrink-0" />}

      <div
        className={`flex flex-col max-w-[70%] ${isMe ? "items-end" : "items-start"}`}
      >
        {/* 상대방일 때만 이름 표시 (연속 메시지면 숨김) */}
        {!isMe && showSenderInfo && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 px-1">
            {senderDisplayName}
          </div>
        )}

        {/* 말풍선 */}
        <div
          className={`
            relative px-4 py-2.5 rounded-2xl text-sm break-words leading-relaxed
            ${
              isMe
                ? "bg-[#fee500] text-black rounded-br-none" // 카카오톡 노란색 느낌
                : "bg-white dark:bg-gray-700 text-black dark:text-white rounded-bl-none shadow-sm"
            }
          `}
        >
          {content}
        </div>

        {/* 시간 (내 메시지는 오른쪽, 상대는 왼쪽 아래) */}
        <div className="text-[10px] text-gray-400 mt-0.5 px-1 flex items-center gap-1">
          {timeStr}
          {isMe && (
            <>
              {status === "sending" && (
                <span className="text-blue-500 font-medium">전송 중...</span>
              )}
              {status === "sent" && (
                <>
                  {!isRead ? (
                    <span className="text-gray-400">✓</span>
                  ) : (
                    <span className="text-blue-500 font-bold">✓✓</span>
                  )}
                </>
              )}
              {status === "failed" && (
                <span className="text-red-500 font-medium">전송 실패</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
