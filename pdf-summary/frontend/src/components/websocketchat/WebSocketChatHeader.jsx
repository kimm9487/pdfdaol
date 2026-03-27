// src/components/websocketchat/ChatHeader.jsx
const TAB_TITLE = {
  users: "실시간 유저",
  chat: "실시간 채팅",
  dm: "귓속말[중요 문서]",
};

export default function ChatHeader({
  isConnected,
  onlineCount = 0,
  activeTab = "chat",
  onClose,
}) {
  const title = TAB_TITLE[activeTab] || TAB_TITLE.chat;

  return (
    <div className="chat-header">
      <div className="chat-header__title">
        <span className="chat-header__live-dot" />
        <span>{title}</span>
        {activeTab === "chat" && <span className="chat-header__live-tag">LIVE</span>}
      </div>

      <div className="chat-header__actions">
        {onlineCount > 0 && (
          <span className="chat-online-count">{onlineCount}명 접속 중</span>
        )}
        <span className="chat-header__badge">{isConnected ? "연결됨" : "재연결 중"}</span>
        <button type="button" className="chat-header__close" onClick={onClose} aria-label="채팅 닫기">
          ✕
        </button>
      </div>
    </div>
  );
}

// commit touch: 260327_웹소켓 도커 최종