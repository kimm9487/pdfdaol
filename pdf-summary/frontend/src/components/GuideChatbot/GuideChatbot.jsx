// [2026-03-25 osj] 서비스 사용법 안내 가이드 챗봇 컴포넌트
import React, { useState, useEffect, useRef } from "react";
import { GUIDE_CATEGORIES, GUIDE_QA } from "./guideData";
import "./GuideChatbot.css";

// [2026-03-25 osj] 챗봇 토글 위에 표시할 로테이션 툴팁 메시지
const TOOLTIP_TIPS = [
  "PDF 요약이 필요하신가요? 📄",
  "OCR 모델은 언제 선택하나요? 🔍",
  "이용 가이드가 궁금하신가요? 📖",
  "무엇이든 물어보세요! 💬",
  "마이페이지에서 뭘 할 수 있나요? 📋",
];

// [2026-03-25 osj] 챗봇 메시지 초기값 (인사 메시지)
const WELCOME_MESSAGE = {
  id: "welcome",
  type: "bot",
  text: "안녕하세요! 서비스 이용 가이드 챗봇입니다 😊\n아래 카테고리에서 궁금한 항목을 선택해 보세요.",
};

const GuideChatbot = () => {
  // [2026-03-25 osj] 패널 열림/닫힘 상태
  const [isOpen, setIsOpen] = useState(false);

  // [2026-03-25 osj] 선택된 카테고리 및 채팅 메시지 목록
  const [activeCategory, setActiveCategory] = useState("basic");
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);

  // [2026-03-30 osj] 로테이션 툴팁 상태
  const [showTooltip, setShowTooltip] = useState(true);
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);

  const messagesEndRef = useRef(null);

  // [2026-03-25 osj] 새 메시지 추가 시 자동 스크롤
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // [2026-03-30 osj] 툴팁 메시지 로테이션: 페이드 아웃 후 다음 메시지로 교체
  useEffect(() => {
    if (!showTooltip || isOpen) return;
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % TOOLTIP_TIPS.length);
        setTipVisible(true);
      }, 350);
    }, 12000);
    return () => clearInterval(interval);
  }, [showTooltip, isOpen]);

  // [2026-03-25 osj] 질문 클릭 → Q+A 메시지 버블로 추가
  const handleQuestionClick = (qa) => {
    const newMessages = [
      {
        id: Date.now(),
        type: "user",
        text: qa.q,
      },
      {
        id: Date.now() + 1,
        type: "bot",
        text: qa.a,
      },
    ];
    setMessages((prev) => [...prev, ...newMessages]);
  };

  // [2026-03-25 osj] 대화 초기화
  const handleReset = () => {
    setMessages([WELCOME_MESSAGE]);
    setActiveCategory("basic");
  };

  const currentQAList = GUIDE_QA[activeCategory] ?? [];

  return (
    <>
      {/* [2026-03-30 osj] 토글 버튼 위 로테이션 툴팁 버블 */}
      {showTooltip && !isOpen && (
        <div
          className={`guide-tooltip-bubble ${tipVisible ? "tip-visible" : "tip-hidden"}`}
        >
          <button
            className="guide-tooltip-close"
            onClick={() => setShowTooltip(false)}
            aria-label="툴팁 닫기"
          >
            ×
          </button>
          <p className="guide-tooltip-text">{TOOLTIP_TIPS[tipIndex]}</p>
          <span
            className="guide-tooltip-sub guide-tooltip-sub--link"
            onClick={() => setIsOpen(true)}
          >
            이용 가이드 열기 👆
          </span>
        </div>
      )}

      {/* [2026-03-25 osj] 챗봇 토글 버튼 */}
      <button
        className={`guide-chatbot-toggle ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title="이용 가이드"
        aria-label="가이드 챗봇 열기/닫기"
      >
        {isOpen ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          /* 열린 책 아이콘 - 가이드 느낌 */
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5C10.55 4.9 8.45 4.5 6.5 4.5c-1.95 0-4.05.4-5.5 1.5V19.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 19.45 5.05 19 6.5 19c1.95 0 3.75.4 5.5 1.5 1.65-1.05 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z" />
          </svg>
        )}
      </button>

      {/* [2026-03-25 osj] 사이드 패널 */}
      <div className={`guide-chatbot-panel ${isOpen ? "panel-open" : ""}`}>
        {/* 패널 헤더 */}
        <div className="guide-chatbot-header">
          <span>📖 이용 가이드</span>
          <button
            className="guide-reset-btn"
            onClick={handleReset}
            title="대화 초기화"
          >
            초기화
          </button>
        </div>

        {/* 카테고리 탭 */}
        <div className="guide-category-tabs">
          {GUIDE_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`guide-tab ${activeCategory === cat.id ? "active" : ""}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* 채팅 메시지 영역 */}
        <div className="guide-messages">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`guide-bubble guide-bubble-${msg.type}`}
            >
              {msg.type === "bot" && <span className="guide-bot-icon">🤖</span>}
              <div className="guide-bubble-text">
                {msg.text.split("\n").map((line, i) => (
                  <span key={i}>
                    {line}
                    {i < msg.text.split("\n").length - 1 && <br />}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 현재 카테고리 질문 버튼 목록 */}
        <div className="guide-questions">
          <p className="guide-questions-label">질문을 선택하세요</p>
          {currentQAList.map((qa, idx) => (
            <button
              key={idx}
              className="guide-question-btn"
              onClick={() => handleQuestionClick(qa)}
            >
              {qa.q}
            </button>
          ))}
        </div>
      </div>

      {/* [2026-03-25 osj] 패널 열릴 때 외부 클릭으로 닫기 */}
      {isOpen && (
        <div
          className="guide-chatbot-backdrop"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

export default GuideChatbot;