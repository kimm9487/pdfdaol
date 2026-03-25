// src/components/websocketchat/WebSocketChatInput.jsx
import { useState } from 'react';

export default function ChatInput({ onSend, disabled }) {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (!input.trim()) return;
    const success = onSend(input);
    if (success) setInput('');
  };

  return (
    <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center gap-3 max-w-4xl mx-auto">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={disabled ? '연결 대기 중...' : '메시지를 입력하세요...'}
          disabled={disabled}
          className="
            flex-1 px-5 py-3.5 rounded-full border border-gray-300 dark:border-gray-600
            bg-white dark:bg-gray-800 text-gray-900 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:opacity-60 disabled:cursor-not-allowed
            transition-all
          "
        />

        <button
          onClick={handleSubmit}
          disabled={disabled || !input.trim()}
          className="
            px-7 py-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800
            text-white font-medium rounded-full
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors shadow-sm
          "
        >
          보내기
        </button>
      </div>
    </div>
  );
}