import React, { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../config/api";
import "./style.css";

const CHAT_DEFAULT_MODEL = "qwen2.5:3b-instruct";

const ChatSummary = () => {
  const [file, setFile] = useState(null);
  const [models, setModels] = useState([CHAT_DEFAULT_MODEL, "gemma3:latest"]);
  const [selectedModel, setSelectedModel] = useState(CHAT_DEFAULT_MODEL);
  const [ocrModels, setOcrModels] = useState([{ id: "pypdf2", label: "기본 텍스트 추출" }]);
  const [selectedOcrModel, setSelectedOcrModel] = useState("pypdf2");

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "안녕하세요. 파일을 업로드하고 원하는 요청을 입력해 주세요. 예: 핵심 포인트 5개로 요약, 발표용 1분 스크립트로 정리",
    },
  ]);

  const [extractedText, setExtractedText] = useState("");
  const [input, setInput] = useState("");
  const [loadingExtract, setLoadingExtract] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [useLora, setUseLora] = useState(false);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const [modelRes, ocrRes] = await Promise.all([
          fetch(`${API_BASE}/documents/models`),
          fetch(`${API_BASE}/documents/ocr-models`),
        ]);

        if (modelRes.ok) {
          const modelData = await modelRes.json();
          if (Array.isArray(modelData.models) && modelData.models.length > 0) {
            const mergedModels = modelData.models.includes(CHAT_DEFAULT_MODEL)
              ? modelData.models
              : [CHAT_DEFAULT_MODEL, ...modelData.models];
            setModels(mergedModels);
            setSelectedModel(CHAT_DEFAULT_MODEL);
          }
        }

        if (ocrRes.ok) {
          const ocrData = await ocrRes.json();
          if (Array.isArray(ocrData.ocr_models) && ocrData.ocr_models.length > 0) {
            setOcrModels(ocrData.ocr_models);
            setSelectedOcrModel(ocrData.ocr_models[0].id);
          }
        }
      } catch (error) {
        console.error("모델 목록 조회 실패", error);
      }
    };

    loadModels();
  }, []);

  const isReadyForChat = useMemo(() => extractedText.trim().length > 0, [extractedText]);

  const appendMessage = (role, content) => {
    setMessages((prev) => [...prev, { role, content }]);
  };

  const handleExtract = async () => {
    if (!file) {
      appendMessage("assistant", "먼저 PDF 파일을 선택해 주세요.");
      return;
    }

    setLoadingExtract(true);
    appendMessage("assistant", "문서 텍스트를 추출하고 있습니다. 잠시만 기다려 주세요...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ocr_model", selectedOcrModel);

      const response = await fetch(`${API_BASE}/documents/extract-chat`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        appendMessage("assistant", data.detail || "텍스트 추출 중 오류가 발생했습니다.");
        return;
      }

      setExtractedText(data.extracted_text || "");
      appendMessage(
        "assistant",
        `텍스트 추출 완료: ${(data.filename || file.name)} / 문자수 ${data.extraction_info?.char_count || 0}`
      );
    } catch (error) {
      appendMessage("assistant", `추출 실패: ${error.message}`);
    } finally {
      setLoadingExtract(false);
    }
  };

  const handleSend = async () => {
    const instruction = input.trim();
    if (!instruction) return;
    const userDbId = localStorage.getItem("userDbId");

    appendMessage("user", instruction);
    setInput("");

    if (!isReadyForChat) {
      appendMessage("assistant", "먼저 왼쪽에서 파일을 추출해 주세요.");
      return;
    }

    setLoadingChat(true);
    try {
      const response = await fetch(`${API_BASE}/documents/chat-summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_text: extractedText,
          instruction,
          model: selectedModel,
          user_id: userDbId ? parseInt(userDbId, 10) : null,
          use_rag: useRag,
          use_lora: useLora,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        appendMessage("assistant", data.detail || "응답 생성 중 오류가 발생했습니다.");
        return;
      }

      appendMessage("assistant", data.answer || "응답이 비어 있습니다.");
    } catch (error) {
      appendMessage("assistant", `요청 실패: ${error.message}`);
    } finally {
      setLoadingChat(false);
    }
  };

  return (
    <div className="chat-summary-wrap">
      <aside className="chat-panel">
        <h2>대화형 요약</h2>
        <p>파일을 추출한 뒤 원하는 방식으로 질문하세요.</p>

        <label className="upload-box">
          <input
            type="file"
            accept=".pdf,.doc,.docx,.hwpx,.jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff,.gif"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <span>{file ? file.name : "파일 선택"}</span>
        </label>

        <label className="field-label">OCR 모델</label>
        <select
          className="field-select"
          value={selectedOcrModel}
          onChange={(e) => setSelectedOcrModel(e.target.value)}
        >
          {ocrModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} - {m.label}
            </option>
          ))}
        </select>

        <label className="field-label">대화 모델</label>
        <select
          className="field-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={useRag}
            onChange={(e) => setUseRag(e.target.checked)}
          />
          <span>RAG 검색 문맥 사용</span>
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={useLora}
            onChange={(e) => setUseLora(e.target.checked)}
          />
          <span>LoRA 파인튜닝 모델 사용</span>
        </label>

        <button type="button" className="primary-btn" onClick={handleExtract} disabled={loadingExtract}>
          {loadingExtract ? "추출 중..." : "문서 텍스트 추출"}
        </button>
      </aside>

      <section className="chat-window">
        <div className="messages">
          {messages.map((msg, idx) => (
            <div key={`${msg.role}-${idx}`} className={`bubble ${msg.role}`}>
              {msg.content}
            </div>
          ))}
        </div>

        <div className="chat-input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="예: 핵심 포인트 3개만 bullet로 정리해줘"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button type="button" onClick={handleSend} disabled={loadingChat}>
            {loadingChat ? "생성 중" : "전송"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default ChatSummary;
