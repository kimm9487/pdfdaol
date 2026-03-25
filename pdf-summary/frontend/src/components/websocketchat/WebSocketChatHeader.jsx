// src/components/websocketchat/ChatHeader.jsx
export default function ChatHeader({ isConnected, onlineCount = 0 }) {
  return (
    <div className="px-4 py-3.5 bg-blue-600 text-white font-semibold flex items-center justify-between shadow-sm">
      <span className="flex items-center gap-2">
        실시간 채팅
        {/* 동적 접속 인원 뱃지 */}
        {onlineCount > 0 && (
          <span className="chat-online-count">
            {onlineCount}명 접속 중
          </span>
        )}
      </span>
      <span className="text-sm opacity-90">
        {isConnected ? '(연결됨)' : '(연결 시도 중...)'}
      </span>
    </div>
  );
}