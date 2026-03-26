// src/components/websocketchat/WebSocketChatInput.jsx
import { useEffect, useState } from 'react';

export default function ChatInput({ onSend, disabled, onTypingChange }) {
  const [input, setInput] = useState('');

  // 입력값이 남아 있는 동안 주기적으로 typing 상태를 유지한다.
  useEffect(() => {
    if (!onTypingChange || !input.trim()) return;

    const intervalId = setInterval(() => {
      onTypingChange(input);
    }, 2300);

    return () => clearInterval(intervalId);
  }, [input, onTypingChange]);

  const handleSubmit = () => {
    if (!input.trim()) return;
    const success = onSend(input);
    if (success) {
      setInput('');
      if (onTypingChange) onTypingChange('');
    }
  };

  return (
    <>
      <input
        value={input}
        onChange={(e) => {
          const nextValue = e.target.value;
          setInput(nextValue);
          if (onTypingChange) onTypingChange(nextValue);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={disabled ? '연결 대기 중...' : '메시지를 입력하세요...'}
        disabled={disabled}
        aria-label="메시지 입력"
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !input.trim()}
        className="chat-send-btn"
        aria-label="메시지 전송"
      >
        ➤
      </button>
    </>
  );
}