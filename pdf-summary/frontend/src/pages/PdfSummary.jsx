import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionValidator } from '../hooks/useSessionValidator';
import { useLogout } from '../hooks/useLogout';
import { API_BASE } from '../config/api';
import './PdfSummary.css';

const PdfSummary = () => {
  const navigate = useNavigate();

  // ===== [추가] 세션 유효성 검증 =====
  useSessionValidator(); 

  console.log("📄 PdfSummary 컴포넌트 렌더링됨");

  // ===== [추가] 로그아웃 핸들러 =====
  const handleLogout = useLogout(null, { showAlert: false });

  useEffect(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");

    if (!userDbId || !sessionToken) {
      console.log("로그인 정보 없음, 로그아웃 처리");
      handleLogout();
    }
  }, []); 

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

  const processFile = (selectedFile) => {
    if (!selectedFile.type.includes("pdf")) {
      setStatus({ type: "error", msg: "PDF 파일만 선택해주세요." });
      return;
    }
    setFile(selectedFile);
    setFileName(selectedFile.name);
    setStatus({ type: "", msg: "" });
    setResult(null);
    setIsImportant(false);
    setDocumentPassword("");
    setIsPublic(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      processFile(droppedFiles[0]);
    }
  };

  const handleSummarize = async () => {
    if (!file) return;

    setLoading(true);
    setStatus({ type: "info", msg: "AI가 문서를 분석 중입니다. 잠시 기다려주세요..." });
    setResult(null);

    try {
      const userDbId = localStorage.getItem("userDbId");
      if (!userDbId) {
        setStatus({ type: "error", msg: "사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요." });
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("user_id", parseInt(userDbId));
      formData.append("model", selectedModel);
      formData.append("is_important", isImportant);
      formData.append("password", isImportant ? documentPassword : null);
      formData.append("is_public", isPublic);

      const res = await fetch(`${API_BASE}/summarize`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.detail || data.message || "요약 중 오류가 발생했습니다.";
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      setResult(data);
      setStatus({ type: "", msg: "" });
    } catch (err) {
      setStatus({ type: "error", msg: "서버 연결 실패: " + err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const element = document.createElement("a");
    const fileContent = new Blob([result.summary], { type: "text/plain" });
    element.href = URL.createObjectURL(fileContent);
    element.download = `${fileName.replace(".pdf", "")}_요약.txt`;
    document.body.appendChild(element);
    element.click();
  };

  // ===== [수정됨] 번역 함수 통합 및 구문 오류 해결 =====
  const handleTranslate = async (textType) => {
    if (!result || !result.id) return;

    const isOriginal = textType === "original";
    if (isOriginal) setTranslatingOriginal(true);
    else setTranslatingSummary(true);

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
        throw new Error(data.detail || "번역 중 오류가 발생했습니다.");
      }

      setTranslations((prev) => ({
        ...prev,
        [textType]: data.translated_text,
      }));
      
      setStatus({ type: 'info', msg: '번역이 완료되었습니다.' });
      setTimeout(() => setStatus({ type: "", msg: "" }), 3000);
    } catch (err) {
      console.error("번역 오류:", err);
      setStatus({ type: "error", msg: err.message });
    } finally {
      if (isOriginal) setTranslatingOriginal(false);
      else setTranslatingSummary(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <div className="card-header">
          <div className="card-title">PDF 요약 도구 - AI Analysis</div>
          <div className="header-buttons">
            <button className="summary-list-btn" onClick={() => navigate("/userlist")}>
              요약 목록 보기
            </button>
            {isAdmin && (
              <button className="admin-dashboard-btn" onClick={() => navigate("/admin")}>
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
            <input type="file" onChange={handleFileChange} accept=".pdf" style={{ display: "none" }} />
            <span className={`file-name ${file ? "selected" : ""}`}>{fileName}</span>
          </label>

          <button className="btn-summarize" onClick={handleSummarize} disabled={!file || loading}>
            {!loading ? <span>요약하기</span> : <div className="spinner"></div>}
          </button>
        </div>

        <div className="model-row">
          <span className="model-label">AI 모델:</span>
          <select className="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
            {models.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </div>

        <div className="important-doc-section">
          <label className="checkbox-label">
            <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />
            <span className="checkbox-text">🔒 중요문서 (비밀번호 보호)</span>
          </label>

          {isImportant && (
            <div className="password-input-group">
              <input
                type="text"
                placeholder="4자리 숫자"
                value={documentPassword}
                onChange={(e) => setDocumentPassword(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                maxLength="4"
                className="password-input"
              />
            </div>
          )}

          <label className="checkbox-label">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            <span className="checkbox-text">📖 공개</span>
          </label>
        </div>

        {status.msg && <div className={`status ${status.type}`}>{status.msg}</div>}

        {result && (
          <div className="result-section visible">
            <hr className="divider" />
            <div className="section-header">
              <span className="section-title">📃 원문 전체</span>
              <span className="section-meta">총 {result.original_length?.toLocaleString()}자</span>
            </div>
            <div className="original-box">{result.extracted_text}</div>

            <button className="btn-translate" onClick={() => handleTranslate("original")} disabled={translatingOriginal}>
              {translatingOriginal ? "번역 중..." : "🌐 원문을 영문으로 번역"}
            </button>

            {translations.original && (
              <div className="translated-box">
                <div className="translated-header">📝 영문 원문</div>
                <div className="translated-content">{translations.original}</div>
              </div>
            )}

            <hr className="divider" />
            <div className="section-header">
              <span className="section-title">🤖 AI 요약 결과</span>
              <span className="section-meta">{result.model_used}</span>
            </div>
            <div className="summary-box">{result.summary}</div>

            <button className="btn-translate" onClick={() => handleTranslate("summary")} disabled={translatingSummary}>
              {translatingSummary ? "번역 중..." : "🌐 요약을 영문으로 번역"}
            </button>

            {translations.summary && (
              <div className="translated-box">
                <div className="translated-header">📝 영문 요약</div>
                <div className="translated-content">{translations.summary}</div>
              </div>
            )}

            <div className="result-actions">
              <button className="btn-download" onClick={handleDownload}>TXT 다운로드</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfSummary;