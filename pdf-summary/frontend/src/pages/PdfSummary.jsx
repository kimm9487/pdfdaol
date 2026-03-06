<<<<<<< HEAD
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionValidator } from "../hooks/useSessionValidator";
import { useLogout } from "../hooks/useLogout";
import "./PdfSummary.css";
=======
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionValidator } from '../hooks/useSessionValidator';
import { useLogout } from '../hooks/useLogout';
import { API_BASE } from '../config/api';
import './PdfSummary.css';
>>>>>>> d4b3e0e02102c72f9252fba01d50e8edf1cbee3c

const PdfSummary = () => {
  const navigate = useNavigate();

  // ===== [추가] 세션 유효성 검증 (10분 주기, 강제 로그아웃 대상은 즉시+5초) =====
  useSessionValidator(); // 기본값 10분, 강제 로그아웃 대상이면 즉시+5초 주기로 검증

<<<<<<< HEAD
  console.log("📄 PdfSummary 컴포넌트 렌더링됨");
  const API_BASE = "http://localhost:8000/api";
=======
    console.log("📄 PdfSummary 컴포넌트 렌더링됨");
>>>>>>> d4b3e0e02102c72f9252fba01d50e8edf1cbee3c

  // ===== [추가] 로그인 정보 확인 =====
  const handleLogout = useLogout(null, { showAlert: false });

  useEffect(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");

    if (!userDbId || !sessionToken) {
      console.log("로그인 정보 없음, 로그아웃 처리");
      handleLogout();
    }
  }, []); // 마운트할 때 한 번만 실행

  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("파일 선택 - 선택된 파일 없음");
  const [models, setModels] = useState(["gemma3:latest"]);
  const [selectedModel, setSelectedModel] = useState("gemma3:latest");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "", msg: "" });
  const [result, setResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [translatingOriginal, setTranslatingOriginal] = useState(false);
  const [translatingSummary, setTranslatingSummary] = useState(false);
  const [translations, setTranslations] = useState({
    original: null,
    summary: null,
  });
  const [isDragActive, setIsDragActive] = useState(false);

  // [추가] 중요 문서 관련 상태
  const [isImportant, setIsImportant] = useState(false);
  const [documentPassword, setDocumentPassword] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  // 사용자 권한 확인
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    setIsAdmin(userId === "admin");
  }, []);

  // 초기 모델 목록 로드
  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/models`);
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setModels(data.models);
            setSelectedModel(data.models[0]);
          }
        }
      } catch (err) {
        console.error("모델 로드 실패:", err);
      }
    };
    loadModels();
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  // [추가] 파일 처리 공통 함수
  const processFile = (selectedFile) => {
    // PDF 파일만 허용
    if (!selectedFile.type.includes("pdf")) {
      setStatus({ type: "error", msg: "PDF 파일만 선택해주세요." });
      return;
    }

    setFile(selectedFile);
    setFileName(selectedFile.name);
    setStatus({ type: "", msg: "" });
    setResult(null);
    // [추가] 파일 선택 시 중요문서 관련 상태 초기화
    setIsImportant(false);
    setDocumentPassword("");
    setIsPublic(true);
  };

  // [추가] 드래그 오버 이벤트
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  // [추가] 드래그 리브 이벤트
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  // [추가] 드롭 이벤트
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      const droppedFile = droppedFiles[0];
      processFile(droppedFile);
    }
  };

  const handleSummarize = async () => {
    if (!file) return;

    setLoading(true);
    setStatus({
      type: "info",
      msg: "AI가 문서를 분석 중입니다. 잠시 기다려주세요...",
    });
    setResult(null);

    try {
      const userDbId = localStorage.getItem("userDbId");
      console.log("userDbId from localStorage:", userDbId);

      if (!userDbId) {
        setStatus({
          type: "error",
          msg: "사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.",
        });
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("user_id", parseInt(userDbId)); // 정수로 변환
      formData.append("model", selectedModel);
      // [추가] 중요문서 관련 정보 추가
      formData.append("is_important", isImportant);
      formData.append("password", isImportant ? documentPassword : null);
      formData.append("is_public", isPublic);

      console.log(
        "Sending summarize request with user_id:",
        parseInt(userDbId),
        "model:",
        selectedModel,
        "is_important:",
        isImportant,
      );

      const res = await fetch(`${API_BASE}/summarize`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      console.log("Response status:", res.status, "Data:", data);

      if (!res.ok) {
        const errorMsg =
          data.detail ||
          data.message ||
          JSON.stringify(data) ||
          "요약 중 오류가 발생했습니다.";
        console.error("API Error:", errorMsg);
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      setResult(data);
      setStatus({ type: "", msg: "" });
    } catch (err) {
      console.error("Fetch Error:", err);
      setStatus({
        type: "error",
        msg:
          "서버에 연결할 수 없습니다. 백엔드(localhost:8000)를 확인해주세요. 에러: " +
          err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    const element = document.createElement("a");
    const fileContent = new Blob([result.summary], { type: "text/plain" });
    element.href = URL.createObjectURL(fileContent);
    element.download = `${fileName.replace(".pdf", "")}_요약.txt`;
    document.body.appendChild(element);
    element.click();
  };

  const handleTranslate = async (textType) => {
    if (!result || !result.id) return;

    const isOriginal = textType === "original";

    if (isOriginal) {
      setTranslatingOriginal(true);
    } else {
      setTranslatingSummary(true);
    }

    try {
      const userDbId = localStorage.getItem("userDbId");

      const formData = new FormData();
      formData.append("document_id", result.id);
      formData.append("user_id", parseInt(userDbId));
      formData.append("text_type", textType);
      formData.append("model", selectedModel);

      const res = await fetch(`${API_BASE}/translate`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.detail || "번역 중 오류가 발생했습니다.";
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      setTranslations((prev) => ({
        ...prev,
        [textType]: data.translated_text,
      }));

<<<<<<< HEAD
      setStatus({
        type: "success",
        msg: `${textType === "original" ? "원문" : "요약"}이 영문으로 번역되어 저장되었습니다.`,
      });
=======
            setResult(data);
            setStatus({ type: '', msg: '' });
        } catch (err) {
            console.error("Fetch Error:", err);
            setStatus({ type: 'error', msg: "서버에 연결할 수 없습니다. 백엔드 API 주소를 확인해주세요. 에러: " + err.message });
        } finally {
            setLoading(false);
        }
    };
>>>>>>> d4b3e0e02102c72f9252fba01d50e8edf1cbee3c

      setTimeout(() => setStatus({ type: "", msg: "" }), 3000);
    } catch (err) {
      console.error("번역 오류:", err);
      setStatus({ type: "error", msg: "번역 중 오류가 발생했습니다." });
    } finally {
      if (isOriginal) {
        setTranslatingOriginal(false);
      } else {
        setTranslatingSummary(false);
      }
    }
  };

  return (
    <div className="container">
      {/* 🚩 중복되었던 nav-header 부분을 삭제했습니다. */}

      <div className="card">
        <div className="card-header">
          <div className="card-title">PDF 요약 도구 - AI Analysis</div>
          <div className="header-buttons">
            <button
              className="summary-list-btn"
              onClick={() => navigate("/userlist")}
              title="요약 목록 조회"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="15" y2="16" />
              </svg>
              요약 목록 보기
            </button>
            {isAdmin && (
              <button
                className="admin-dashboard-btn"
                onClick={() => navigate("/admin")}
                title="관리자 대시보드"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                관리자 대시보드
              </button>
            )}
          </div>
        </div>

        <div
          className={`upload-row ${isDragActive ? "drag-active" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <label className={`file-label ${file ? "has-file" : ""}`}>
            <input
              type="file"
              onChange={handleFileChange}
              accept=".pdf"
              style={{ display: "none" }}
            />
            <svg
              className="file-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className={`file-name ${file ? "selected" : ""}`}>
              {fileName}
            </span>
          </label>

          <button
            className="btn-summarize"
            onClick={handleSummarize}
            disabled={!file || loading}
          >
            {!loading ? <span>요약하기</span> : <div className="spinner"></div>}
          </button>
        </div>

        <div className="model-row">
          <span className="model-label">AI 모델:</span>
          <select
            className="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* [추가] 중요문서 관련 UI */}
        <div className="important-doc-section">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isImportant}
              onChange={(e) => setIsImportant(e.target.checked)}
            />
            <span className="checkbox-text">🔒 중요문서 (비밀번호 보호)</span>
          </label>

          {isImportant && (
            <div className="password-input-group">
              <input
                type="text"
                placeholder="4자리 숫자"
                value={documentPassword}
                onChange={(e) => {
                  // 숫자만 입력 가능, 최대 4자리
                  const value = e.target.value
                    .replace(/[^0-9]/g, "")
                    .slice(0, 4);
                  setDocumentPassword(value);
                }}
                maxLength="4"
                className="password-input"
              />
              <span className="password-hint">
                {documentPassword.length}/4 (숫자만 입력)
              </span>
            </div>
          )}

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span className="checkbox-text">📖 공개 (체크 해제 시 비공개)</span>
          </label>
        </div>

        {status.msg && (
          <div className={`status ${status.type}`}>{status.msg}</div>
        )}

        {result && (
          <div className="result-section visible">
            <hr className="divider" />
            <div className="section-header">
              <span className="section-title">📃 원문 전체</span>
              <span className="section-meta">
                총 {result.original_length.toLocaleString()}자
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
                    <div className="spinner-small"></div>
                    번역 중...
                  </>
                ) : (
                  <>🌐 원문을 영문으로 번역</>
                )}
              </button>
            </div>

            {translations.original && (
              <div className="translated-box">
                <div className="translated-header">📝 영문 원문</div>
                <div className="translated-content">
                  {translations.original}
                </div>
              </div>
            )}

            <hr className="divider" />
            <div className="section-header">
              <span className="section-title">🤖 AI 요약 결과</span>
              <span className="section-meta">{result.model_used}</span>
            </div>
            <div className="summary-box">{result.summary}</div>

            <div className="translation-section">
              <button
                className="btn-translate"
                onClick={() => handleTranslate("summary")}
                disabled={translatingSummary}
              >
                {translatingSummary ? (
                  <>
                    <div className="spinner-small"></div>
                    번역 중...
                  </>
                ) : (
                  <>🌐 요약을 영문으로 번역</>
                )}
              </button>
            </div>

            {translations.summary && (
              <div className="translated-box">
                <div className="translated-header">📝 영문 요약</div>
                <div className="translated-content">{translations.summary}</div>
              </div>
            )}

            <div className="result-actions">
              <button className="btn-download" onClick={handleDownload}>
                TXT 다운로드
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfSummary;
