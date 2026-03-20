// src/components/WebSocketChat.jsx
import React, { useState } from 'react';
import WebSocketChatWindow from './websocketchat/WebSocketChatWindow';
import './websocketchat/WebSocketChat.css';

export default function WebSocketChat() {
  const [showChat, setShowChat] = useState(false);

  // 비로그인 → 렌더링 안 함
  if (localStorage.getItem('isLoggedIn') !== 'true') {
    return null;
  }

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        className="floating-chat-btn"
        onClick={() => setShowChat(prev => !prev)}
        title="실시간 채팅 열기"
      >
        💬
      </button>

      {/* 채팅 패널 */}
      {showChat && (
        <div className="floating-chat-panel">
          <div className="chat-header">
            <h3>실시간 채팅</h3>
            <button onClick={() => setShowChat(false)}>✕</button>
          </div>

          <div className="chat-body">
            <WebSocketChatWindow />
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