// src/components/websocketchat/WebSocketMessageItem.jsx
import { format } from "date-fns";

export default function MessageBubble({ message }) {
  const {
    senderId,
    senderName,
    senderRole,
    content,
    timestamp,
    isSystem,
    isContinuous = false,
    showSenderInfo = true,
    status,
    isRead = true, // ← 추가
  } = message || {};

  if (isSystem) {
    const text = String(content || "");
    const isPermanentNotice = text.includes("영구 정지");
    const isTimedBanNotice =
      text.includes("1일 채팅 금지") ||
      text.includes("1일 채팅금지") ||
      text.includes("채팅 금지") ||
      text.includes("채팅금지");
    const isKickNotice = text.includes("강제 퇴장") || text.includes("강퇴");
    const isModerationNotice = isPermanentNotice || isTimedBanNotice || isKickNotice;

    const actionText = isPermanentNotice
      ? "영구 정지"
      : isTimedBanNotice
      ? "1일 채팅 금지"
      : isKickNotice
      ? "강제 퇴장"
      : "";

    const targetFromAdminSentence = text.match(/님이\s+(.+?)님을/);
    const targetFromFlatSentence = text.match(/^\s*(.+?)님\s+(강제 퇴장|1일 채팅 금지|1일 채팅금지|영구 정지)/);
    const targetName =
      targetFromAdminSentence?.[1] ||
      targetFromFlatSentence?.[1] ||
      "대상 사용자";

    const reasonMatch = text.match(/사유\s*[:：]?\s*(.+)$/);
    const reason = reasonMatch?.[1] || "운영 정책 위반";

    const normalizedText = isModerationNotice
      ? `${targetName}님 ${actionText} · ${reason}`
      : text;

    return (
      <div className="flex justify-center my-3">
        <span className={`chat-system-message ${isModerationNotice ? "moderation" : ""}`.trim()}>
          {normalizedText}
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
  const isAdminSender = String(senderRole || "").toLowerCase() === "admin";
  const rowClass = isMe ? "me" : "other";
  const continuousClass = isContinuous
    ? isMe
      ? "cont-me"
      : "cont-other"
    : "";

  return (
    <div className={`chat-msg-row ${rowClass} ${continuousClass}`.trim()}>
      {/* 상대방 메시지일 때: 왼쪽에 아바타 */}
      {!isMe && showSenderInfo && (
        <div
          className={`chat-msg-avatar ${isAdminSender ? "admin" : ""}`}
          title={senderDisplayName}
          style={{
            background: isAdminSender ? "#f59e0b" : "#7f93b2",
          }}
        >
          {avatarLabel}
          {isAdminSender && (
            <span className="chat-msg-avatar__crown" aria-hidden="true">
              👑
            </span>
          )}
        </div>
      )}

      {/* 연속 메시지면 아바타 공간만큼 패딩 유지 */}
      {!isMe && !showSenderInfo && <div className="chat-msg-avatar-spacer" />}

      <div className={`chat-bubble-wrap ${isMe ? "me" : "other"}`}>
        {/* 상대방일 때만 이름 표시 (연속 메시지면 숨김) */}
        {!isMe && showSenderInfo && (
          <div className="chat-sender-name">
            {senderDisplayName}
          </div>
        )}

        {/* 말풍선 */}
        <div className={`chat-bubble ${isMe ? "me" : "other"} ${isAdminSender ? "admin" : ""}`}>
          {content}
        </div>

        {/* 시간 (내 메시지는 오른쪽, 상대는 왼쪽 아래) */}
        <div className={`chat-msg-meta ${isMe ? "me" : ""}`.trim()}>
          {timeStr}
          {isMe && (
            <>
              {status === "sending" && (
                <span className="chat-msg-unread">전송 중...</span>
              )}
              {status === "sent" && (
                <>
                  {!isRead ? (
                    <span className="chat-msg-unread">✓</span>
                  ) : (
                    <span className="chat-msg-read">✓✓</span>
                  )}
                </>
              )}
              {status === "failed" && (
                <span className="chat-msg-unread">전송 실패</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}