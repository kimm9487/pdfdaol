import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionValidator } from "../hooks/useSessionValidator";
import { useLogout } from "../hooks/useLogout";
import { API_BASE } from "../config/api";
import "./PdfSummary.css";

const PdfSummary = () => {
  const navigate = useNavigate();

  // ===== 세션 유효성 검증 및 로그아웃 처리 (HEAD 반영) =====
  useSessionValidator();
  const handleLogout = useLogout(null, { showAlert: false });

  useEffect(() => {
    console.log("📄 PdfSummary 컴포넌트 렌더링됨");
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");

    if (!userDbId || !sessionToken) {
      console.log("로그인 정보 없음, 로그아웃 처리");
      handleLogout();
    }
  }, [handleLogout]);

  // ===== 상태 관리 =====
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("파일 선택 - 선택된 파일 없음");

  // 모델 관련 상태 (Incoming 반영)
  const [models, setModels] = useState(["gemma3:latest"]);
  const [selectedModel, setSelectedModel] = useState("gemma3:latest");
  const [ocrModels, setOcrModels] = useState([
    { id: "pypdf2", label: "기본 텍스트 추출 (텍스트 기반 PDF)" },
  ]);
  const [selectedOcrModel, setSelectedOcrModel] = useState("pypdf2");

  // 진행 상태 관련
  const [loading, setLoading] = useState(false); // 추출용 로딩
  const [summarizing, setSummarizing] = useState(false); // 요약용 로딩
  const [status, setStatus] = useState({ type: "", msg: "" });
  const [result, setResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  // 번역 관련 상태
  const [translatingOriginal, setTranslatingOriginal] = useState(false);
  const [translatingSummary, setTranslatingSummary] = useState(false);
  const [translations, setTranslations] = useState({
    original: null,
    summary: null,
  });

  // 문서 보안 관련 상태
  const [isImportant, setIsImportant] = useState(false);
  const [documentPassword, setDocumentPassword] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  // ===== 유틸리티 함수 (Incoming 반영) =====
  const getFileExtension = (name) => {
    const idx = name.lastIndexOf(".");
    if (idx < 0) return "";
    return name.slice(idx).toLowerCase();
  };

  const getAllowedExtensions = (ocrModel) => {
    if ((ocrModel || "").toLowerCase() === "pypdf2") {
      return [".pdf"];
    }
    return [
      ".pdf",
      ".doc",
      ".docx",
      ".hwpx",
      ".jpg",
      ".jpeg",
      ".png",
      ".bmp",
      ".webp",
      ".tif",
      ".tiff",
      ".gif",
    ];
  };

  const getAcceptByModel = (ocrModel) =>
    getAllowedExtensions(ocrModel).join(",");

  // ===== 초기 데이터 로드 =====
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    setIsAdmin(userId === "admin");
  }, []);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/models`);
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setModels(data.models);
            const preferredOrder = ["gemma3:latest", "gemma3:lastest"];
            const preferred = preferredOrder.find((name) =>
              data.models.includes(name),
            );
            setSelectedModel(preferred || data.models[0]);
          }
        }

        const ocrRes = await fetch(`${API_BASE}/ocr-models`);
        if (ocrRes.ok) {
          const ocrData = await ocrRes.json();
          if (ocrData.ocr_models && ocrData.ocr_models.length > 0) {
            setOcrModels(ocrData.ocr_models);
            setSelectedOcrModel(ocrData.ocr_models[0].id);
          }
        }
      } catch (err) {
        console.error("모델 로드 실패:", err);
      }
    };
    loadModels();
  }, []);

  // OCR 모델 변경 시 지원하지 않는 확장자면 초기화
  useEffect(() => {
    if (!file) return;
    const extension = getFileExtension(file.name || "");
    const allowed = getAllowedExtensions(selectedOcrModel);

    if (!allowed.includes(extension)) {
      setFile(null);
      setFileName("파일 선택 - 선택된 파일 없음");
      setResult(null);
      setStatus({
        type: "info",
        msg: `선택한 OCR 모델이 변경되어 파일이 초기화되었습니다. 허용 형식: ${allowed.join(", ")}`,
      });
    }
  }, [selectedOcrModel, file]);

  // ===== 이벤트 핸들러 =====
  const processFile = (selectedFile) => {
    const extension = getFileExtension(selectedFile.name || "");
    const allowed = getAllowedExtensions(selectedOcrModel);

    if (!allowed.includes(extension)) {
      const modelName =
        (selectedOcrModel || "").toLowerCase() === "pypdf2"
          ? "pypdf2"
          : selectedOcrModel;
      setStatus({
        type: "error",
        msg: `${modelName} 모델은 ${allowed.join(", ")} 파일만 지원합니다.`,
      });
      return;
    }

    setFile(selectedFile);
    setFileName(selectedFile.name);
    setStatus({ type: "", msg: "" });
    setResult(null);
    setTranslations({ original: null, summary: null });
    setIsImportant(false);
    setDocumentPassword("");
    setIsPublic(true);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) processFile(selectedFile);
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
    if (droppedFiles.length > 0) processFile(droppedFiles[0]);
  };

  // 1단계: 텍스트 추출 (Incoming 반영)
  const handleExtract = async () => {
    if (!file) return;

    setLoading(true);
    setStatus({
      type: "info",
      msg: "선택한 OCR 모델로 문서를 추출 중입니다. 잠시 기다려주세요...",
    });
    setResult(null);
    setTranslations({ original: null, summary: null });

    try {
      const userDbId = localStorage.getItem("userDbId");
      if (!userDbId) {
        setStatus({
          type: "error",
          msg: "사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.",
        });
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("user_id", String(parseInt(userDbId) || 0));
      formData.append("ocr_model", selectedOcrModel);
      formData.append("is_important", isImportant ? "true" : "false");
      formData.append(
        "password",
        isImportant ? String(documentPassword || "") : "",
      );
      formData.append("is_public", isPublic ? "true" : "false");

      const res = await fetch(`${API_BASE}/extract`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        const errorMsg =
          data.detail ||
          data.message ||
          JSON.stringify(data) ||
          "추출 중 오류가 발생했습니다.";
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      setResult(data);
      setStatus({
        type: "success",
        msg: "텍스트 추출이 완료되었습니다. 이제 LLM 요약을 실행할 수 있습니다.",
      });
    } catch (err) {
      console.error("Fetch Error:", err);
      setStatus({ type: "error", msg: "서버 연결 실패: " + err.message });
    } finally {
      setLoading(false);
    }
  };

  // 2단계: 추출된 텍스트 LLM 요약 (Incoming 반영)
  const handleSummarizeExtracted = async () => {
    if (!result || !result.id) return;

    setSummarizing(true);
    setStatus({
      type: "info",
      msg: "추출된 문서를 LLM이 요약 중입니다. 잠시 기다려주세요...",
    });

    try {
      const userDbId = localStorage.getItem("userDbId");
      const formData = new FormData();
      formData.append("document_id", result.id);
      formData.append("user_id", parseInt(userDbId));
      formData.append("model", selectedModel);

      const res = await fetch(`${API_BASE}/summarize-document`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        const errorMsg =
          data.detail ||
          data.message ||
          JSON.stringify(data) ||
          "요약 중 오류가 발생했습니다.";
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      setResult((prev) => ({
        ...prev,
        summary: data.summary,
        model_used: data.model_used,
        extracted_text: data.extracted_text,
      }));
      setStatus({ type: "success", msg: "LLM 요약이 완료되었습니다." });
    } catch (err) {
      console.error("요약 오류:", err);
      setStatus({
        type: "error",
        msg: "요약 중 오류가 발생했습니다. 에러: " + err.message,
      });
    } finally {
      setSummarizing(false);
    }
  };

  // 번역 처리 (HEAD 구문 수정 반영)
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

      setStatus({
        type: "success",
        msg: `${textType === "original" ? "원문" : "요약"}이 영문으로 번역되었습니다.`,
      });
      setTimeout(() => setStatus({ type: "", msg: "" }), 3000);
    } catch (err) {
      console.error("번역 오류:", err);
      setStatus({ type: "error", msg: err.message });
    } finally {
      if (isOriginal) setTranslatingOriginal(false);
      else setTranslatingSummary(false);
    }
  };

  const handleDownload = () => {
    if (!result || !result.summary) return;
    const element = document.createElement("a");
    const fileContent = new Blob([result.summary], { type: "text/plain" });
    element.href = URL.createObjectURL(fileContent);
    element.download = `${fileName.replace(/\.[^/.]+$/, "")}_요약.txt`;
    document.body.appendChild(element);
    element.click();
  };

  // ===== UI 렌더링 =====
  return (
    <div className="container">
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
              accept={getAcceptByModel(selectedOcrModel)}
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
            onClick={handleExtract}
            disabled={!file || loading}
          >
            {!loading ? <span>추출하기</span> : <div className="spinner"></div>}
          </button>
        </div>

        <div className="model-row">
          <span className="model-label">LLM 요약 모델:</span>
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

        <div className="model-row">
          <span className="model-label">OCR 추출 모델:</span>
          <select
            className="model-select"
            value={selectedOcrModel}
            onChange={(e) => setSelectedOcrModel(e.target.value)}
          >
            {ocrModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} - {m.label}
              </option>
            ))}
          </select>
        </div>

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
              <span className="section-meta">
                {result.model_used || "아직 요약 전"}
              </span>
            </div>

            {!result.summary && (
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

            {result.summary && (
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

            {translations.summary && (
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
        )}
      </div>
    </div>
  );
};

export default PdfSummary;
