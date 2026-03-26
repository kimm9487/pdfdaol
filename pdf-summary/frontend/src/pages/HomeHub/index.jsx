import React from "react";
import { useNavigate } from "react-router-dom";
import "./style.css";

const HomeHub = () => {
  const navigate = useNavigate();

  return (
    <div className="hub-wrap">
      <section className="hub-hero">
        <h1>PDF 요약 도구 - AI Analysis</h1>
        <p>원하는 방식으로 문서를 분석하세요.</p>
      </section>

      <section className="hub-grid">
        <button
          className="hub-card"
          onClick={() => navigate("/pdf-summary")}
          type="button"
        >
          <span className="hub-title">추출 및 요약</span>
          <span className="hub-desc">
            기존 방식: 파일 업로드 후 단계별 처리
          </span>
        </button>

        <button
          className="hub-card alt"
          onClick={() => navigate("/chat-summary")}
          type="button"
        >
          <span className="hub-title">대화형 요약</span>
          <span className="hub-desc">질문하면서 원하는 포맷으로 결과 생성</span>
        </button>
      </section>
    </div>
  );
};

export default HomeHub;