import { useState, useEffect } from "react";
import { useSessionValidator } from "./useSessionValidator";
import { useLogout } from "./useLogout";
import { API_BASE } from "../config/api";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

export const usePdfSummary = () => {
  useSessionValidator();
  const handleLogout = useLogout(null, { showAlert: false });

  useEffect(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");
    if (!userDbId || !sessionToken) {
      handleLogout();
    }
  }, [handleLogout]);

  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("파일 선택 - 선택된 파일 없음");
  const [models, setModels] = useState(["gemma3:latest"]);
  const [selectedModel, setSelectedModel] = useState("gemma3:latest");
  const [ocrModels, setOcrModels] = useState([
    { id: "pypdf2", label: "기본 텍스트 추출 (텍스트 기반 PDF)" },
  ]);
  const [selectedOcrModel, setSelectedOcrModel] = useState("pypdf2");
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [status, setStatus] = useState({ type: "", msg: "" });
  const [result, setResult] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [translatingOriginal, setTranslatingOriginal] = useState(false);
  const [translatingSummary, setTranslatingSummary] = useState(false);
  const [streamingSummary, setStreamingSummary] = useState("");
  const [extractionProgress, setExtractionProgress] = useState({
    mode: null,
    current: 0,
    total: 0,
  });
  const [translations, setTranslations] = useState({
    original: null,
    summary: null,
  });
  const [isImportant, setIsImportant] = useState(false);
  const [documentPassword, setDocumentPassword] = useState("");
  const [isPublic, setIsPublic] = useState(true);

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

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    setIsAdmin(userId === "admin");
  }, []);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/documents/models`);
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
        const ocrRes = await fetch(`${API_BASE}/documents/ocr-models`);
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
    setStreamingSummary("");
    setExtractionProgress({ mode: null, current: 0, total: 0 });
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

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    setStatus({ type: "", msg: "" });
    setResult(null);
    setStreamingSummary("");
    setExtractionProgress({ mode: null, current: 0, total: 0 });
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
      const res = await fetch(`${API_BASE}/documents/extract`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errorMsg = "추출 중 오류가 발생했습니다.";
        try {
          const data = await res.json();
          errorMsg = data.detail || data.message || JSON.stringify(data) || errorMsg;
        } catch (_) {}
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      if (!res.body) {
        setStatus({ type: "error", msg: "스트리밍 응답 본문이 없습니다." });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;

          let event;
          try {
            event = JSON.parse(part.slice(6));
          } catch (_) {
            continue;
          }

          if (event.type === "start") {
            const mode = event.ocr_mode
              ? event.total_pages > 0
                ? "ocr_page"
                : "ocr"
              : "page";
            setExtractionProgress({ mode, current: 0, total: event.total_pages || 0 });
          } else if (event.type === "page") {
            setExtractionProgress({ mode: "page", current: event.page || 0, total: event.total || 0 });
          } else if (event.type === "ocr_progress") {
            setExtractionProgress({ mode: "ocr_page", current: event.page || 0, total: event.total || 0 });
          } else if (event.type === "chunk_start") {
            setExtractionProgress({ mode: "chunk", current: 0, total: event.total_chunks || 0 });
          } else if (event.type === "chunk") {
            setExtractionProgress({ mode: "chunk", current: event.index || 0, total: event.total || 0 });
          } else if (event.type === "done") {
            finalResult = event;
            setExtractionProgress({ mode: null, current: 0, total: 0 });
          } else if (event.type === "error") {
            setStatus({ type: "error", msg: event.detail || "추출 중 오류가 발생했습니다." });
            setExtractionProgress({ mode: null, current: 0, total: 0 });
          }
        }
      }

      if (finalResult) {
        setResult(finalResult);
        setStatus({ type: "success", msg: "텍스트 추출이 완료되었습니다." });
      }
    } catch (err) {
      console.error("Fetch Error:", err);
      setStatus({ type: "error", msg: "서버 연결 실패: " + err.message });
      setExtractionProgress({ mode: null, current: 0, total: 0 });
    } finally {
      setLoading(false);
    }
  };

  const handleSummarizeExtracted = async () => {
    if (!result || !result.id) return;
    setSummarizing(true);
    setStreamingSummary("");
    setStatus({ type: "", msg: "" });
    try {
      const userDbId = localStorage.getItem("userDbId");
      const formData = new FormData();
      formData.append("document_id", result.id);
      formData.append("user_id", parseInt(userDbId));
      formData.append("model", selectedModel);
      const res = await fetch(`${API_BASE}/documents/summarize-document`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errorMsg = "요약 중 오류가 발생했습니다.";
        try {
          const data = await res.json();
          errorMsg = data.detail || data.message || JSON.stringify(data) || errorMsg;
        } catch (_) {}
        setStatus({ type: "error", msg: errorMsg });
        return;
      }

      if (!res.body) {
        setStatus({ type: "error", msg: "스트리밍 응답 본문이 없습니다." });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let modelUsed = selectedModel;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;

          let event;
          try {
            event = JSON.parse(part.slice(6));
          } catch (_) {
            continue;
          }

          if (event.type === "token") {
            accumulatedText += event.text || "";
            setStreamingSummary(accumulatedText);
          } else if (event.type === "done") {
            modelUsed = event.model_used || selectedModel;
          } else if (event.type === "error") {
            setStatus({ type: "error", msg: event.detail || "요약 중 오류가 발생했습니다." });
            setStreamingSummary("");
          }
        }
      }

      if (accumulatedText) {
        setResult((prev) => ({
          ...prev,
          summary: accumulatedText,
          model_used: modelUsed,
        }));
      }
      setStreamingSummary("");
      setStatus({ type: "success", msg: "LLM 요약이 완료되었습니다." });
    } catch (err) {
      console.error("요약 오류:", err);
      setStatus({
        type: "error",
        msg: "요약 중 오류가 발생했습니다. 에러: " + err.message,
      });
      setStreamingSummary("");
    } finally {
      setSummarizing(false);
    }
  };

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
      const res = await fetch(`${API_BASE}/documents/translate`, {
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

  return {
    file,
    fileName,
    models,
    selectedModel,
    setSelectedModel,
    ocrModels,
    selectedOcrModel,
    setSelectedOcrModel,
    loading,
    summarizing,
    status,
    result,
    isAdmin,
    isDragActive,
    translatingOriginal,
    translatingSummary,
    streamingSummary,
    extractionProgress,
    translations,
    isImportant,
    setIsImportant,
    documentPassword,
    setDocumentPassword,
    isPublic,
    setIsPublic,
    getAcceptByModel,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleExtract,
    handleSummarizeExtracted,
    handleTranslate,
    handleDownload,
  };
};