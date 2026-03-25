import React from "react";

const Results = ({
  result,
  translations,
  translatingOriginal,
  translatingSummary,
  summarizing,
<<<<<<< HEAD
  streamingSummary, // [추가] 9줄: 실시간 타이핑 효과를 위한 streaming prop
  streamingTranslationOriginal, // [추가 2026-03-19]: 원문 번역 중 실시간 스트리밍 텍스트
  streamingTranslationSummary, // [추가 2026-03-19]: 요약 번역 중 실시간 스트리밍 텍스트
=======
  streamingSummary,
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
  fileName,
  handleTranslate,
  handleSummarizeExtracted,
  handleDownload,
}) => {
  if (!result) return null;

  return (
    <div className="result-section visible">
      <hr className="divider" />
      <div className="section-header">
        <span className="section-title">📃 원문 전체</span>
        <span className="section-meta">
          총 {result.original_length?.toLocaleString()}자
        </span>
      </div>
      <div className="original-box">{result.extracted_text}</div>

      <div className="translation-section">
        <button
          className="btn-translate"
          onClick={() => handleTranslate("original")}
          disabled={translatingOriginal}
        >
          {translatingOriginal ? (
            <>
              <div className="spinner-small"></div> 번역 중...
            </>
          ) : (
            <>🌐 원문을 영문으로 번역</>
          )}
        </button>
      </div>

<<<<<<< HEAD
      {/* [추가 2026-03-19] 번역 중일 때: 스트리밍 박스 + typing cursor 표시.
          번역이 완료되면 아래 translations.original 블록으로 전환됨. */}
      {translatingOriginal && streamingTranslationOriginal && (
        <div className="translated-box translation-streaming">
          <div className="translated-header">📝 영문 원문</div>
          <div className="translated-content">
            {streamingTranslationOriginal}
            <span className="typing-cursor" />
          </div>
        </div>
      )}
      {/* 번역 완료 후: 스트리밍 상태가 비워지고 translations.original에 최종값 저장됨 */}
      {translations.original && !translatingOriginal && (
        <div className="translated-box">
          <div className="translated-header">📝 영문 원문</div>
          <div className="translated-content">{translations.original}</div>
        </div>
      )}

      <hr className="divider" />
      <div className="section-header">
        <span className="section-title">🤖 AI 요약 결과</span>
        {/* [변경] 55~57줄: 요약 중 여부 표시 */}
=======
      {translations.original && (
        <div className="translated-box">
          <div className="translated-header">📝 영문 원문</div>
          <div className="translated-content">{translations.original}</div>
        </div>
      )}

      {/* --- AI 요약 결과 섹션 --- */}
      <hr className="divider" />
      <div className="section-header">
        <span className="section-title">🤖 AI 요약 결과</span>
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
        <span className="section-meta">
          {summarizing ? "요약 중..." : result.model_used || "아직 요약 전"}
        </span>
      </div>

<<<<<<< HEAD
      {/* [변경] 60~71줄: 요약 중이면 버튼 숫기임 */}
=======
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
      {!result.summary && !summarizing && (
        <div className="translation-section">
          <button
            className="btn-translate"
            onClick={handleSummarizeExtracted}
            disabled={summarizing}
          >
            {summarizing ? (
              <>
                <div className="spinner-small"></div> 요약 중...
              </>
            ) : (
              <>🧠 추출 문서 LLM 요약하기</>
            )}
          </button>
        </div>
      )}

<<<<<<< HEAD
      {/* [추가] 73~82줄: 실시간 스트리밍 표시 (typing 커서 포함) */}
=======
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
      {summarizing && (
        <div className="summary-box summary-streaming">
          {streamingSummary || (
            <span className="summary-waiting">요약을 시작하는 중...</span>
          )}
          <span className="typing-cursor" />
        </div>
      )}

<<<<<<< HEAD
      {/* [변경] 84줄: !summarizing 조건 추가 (streaming 중 중복 미표시) */}
=======
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
      {!summarizing && result.summary && (
        <div className="summary-box">{result.summary}</div>
      )}

      {result.summary && (
        <div className="translation-section">
          <button
            className="btn-translate"
            onClick={() => handleTranslate("summary")}
            disabled={translatingSummary}
          >
            {translatingSummary ? (
              <>
                <div className="spinner-small"></div> 번역 중...
              </>
            ) : (
              <>🌐 요약을 영문으로 번역</>
            )}
          </button>
        </div>
      )}

<<<<<<< HEAD
      {/* [추가 2026-03-19] 요약 번역 중: 스트리밍 박스 + typing cursor 표시 */}
      {translatingSummary && streamingTranslationSummary && (
        <div className="translated-box translation-streaming">
          <div className="translated-header">📝 영문 요약</div>
          <div className="translated-content">
            {streamingTranslationSummary}
            <span className="typing-cursor" />
          </div>
        </div>
      )}
      {/* 번역 완료 후: 스트리밍 상태가 비워지고 translations.summary에 최종값 저장됨 */}
      {translations.summary && !translatingSummary && (
=======
      {translations.summary && (
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
        <div className="translated-box">
          <div className="translated-header">📝 영문 요약</div>
          <div className="translated-content">{translations.summary}</div>
        </div>
      )}

      {result.summary && (
        <div className="result-actions">
          <button className="btn-download" onClick={handleDownload}>
            TXT 다운로드
          </button>
        </div>
      )}
    </div>
  );
};

export default Results;