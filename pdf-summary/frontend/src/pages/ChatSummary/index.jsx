import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { API_BASE } from "../../config/api";
import "./style.css";

const CHAT_DEFAULT_MODEL = "exaone3.5:2.4b";
const MAX_EXTRACT_DOCS = 5;

const IGNORED_PROMPT_PREFIXES = [
  "제공된 텍스트를 요약하세요",
  "요약에 포함되어야 할 내용:",
  "목표 길이:",
  "요약 형식:",
];

const formatFileSize = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const stripInstructionEcho = (text) => {
  if (!text) return text;

  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n");
  const firstMeaningfulIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstMeaningfulIndex === -1) return normalized;

  const firstMeaningfulLine = lines[firstMeaningfulIndex].trim();
  const shouldStrip = IGNORED_PROMPT_PREFIXES.some((prefix) =>
    firstMeaningfulLine.startsWith(prefix)
  );

  if (!shouldStrip) return normalized;

  let removeUntil = firstMeaningfulIndex;
  while (removeUntil < lines.length) {
    const current = lines[removeUntil].trim();
    if (!current) {
      removeUntil += 1;
      continue;
    }

    const isIgnored = IGNORED_PROMPT_PREFIXES.some((prefix) => current.startsWith(prefix));
    if (!isIgnored) break;
    removeUntil += 1;
  }

  return lines.slice(removeUntil).join("\n").trimStart();
};

const extractDropFiles = (fileList) => {
  if (!fileList || fileList.length === 0) return [];
  return Array.from(fileList);
};

const getFileExtension = (name = "") => {
  const lower = String(name).toLowerCase();
  const dotIndex = lower.lastIndexOf(".");
  return dotIndex >= 0 ? lower.slice(dotIndex) : "";
};

const normalizeErrorMessage = (detail, fallback = "오류가 발생했습니다.") => {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      return first.msg || first.message || JSON.stringify(first);
    }
  }
  if (typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return fallback;
};

const createDocId = () => `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildCombinedDocumentText = (docs) => {
  if (!Array.isArray(docs) || docs.length === 0) return "";
  return docs
    .map((doc, index) => {
      const name = doc?.fileName || `문서 ${index + 1}`;
      const text = doc?.text || "";
      return `[문서 ${index + 1}: ${name}]\n${text}`;
    })
    .join("\n\n");
};

const getValidatedFiles = (files, currentCount = 0) => {
  if (files.length > MAX_EXTRACT_DOCS || currentCount + files.length > MAX_EXTRACT_DOCS) {
    toast.error("문서 추출은 5개까지만 가능합니다.");
    return [];
  }
  return files;
};

const preferredChatModels = (models) => {
  const uniqueModels = Array.from(new Set((models || []).filter(Boolean)));
  const priority = ["exaone3.5:2.4b", "gemma3:latest"];
  const ordered = [];

  priority.forEach((model) => {
    if (uniqueModels.includes(model)) ordered.push(model);
  });

  uniqueModels.forEach((model) => {
    if (!ordered.includes(model)) ordered.push(model);
  });

  if (!ordered.length) return [CHAT_DEFAULT_MODEL];
  if (!ordered.includes(CHAT_DEFAULT_MODEL)) {
    ordered.unshift(CHAT_DEFAULT_MODEL);
  }

  return Array.from(new Set(ordered));
};

const ChatSummary = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [models, setModels] = useState([CHAT_DEFAULT_MODEL]);
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

  const [extractedDocs, setExtractedDocs] = useState([]);
  const [activeDocIds, setActiveDocIds] = useState([]);
  const [conversationHistoryBySelection, setConversationHistoryBySelection] = useState({});
  const [input, setInput] = useState("");
  const [loadingExtract, setLoadingExtract] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [useLora, setUseLora] = useState(false);
  const [expandedFileMessages, setExpandedFileMessages] = useState({});
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [waitingFirstToken, setWaitingFirstToken] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const dragDepthRef = useRef(0);
  const messagesContainerRef = useRef(null);

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
            const uniqueModels = preferredChatModels(modelData.models);

            setModels(uniqueModels);
            setSelectedModel(
              uniqueModels.includes(CHAT_DEFAULT_MODEL) ? CHAT_DEFAULT_MODEL : uniqueModels[0]
            );
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

  useEffect(() => {
    const preventDefaults = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleDragEnter = (event) => {
      preventDefaults(event);
      dragDepthRef.current += 1;
      setIsGlobalDragging(true);
    };

    const handleDragOver = (event) => {
      preventDefaults(event);
      if (!isGlobalDragging) setIsGlobalDragging(true);
    };

    const handleDragLeave = (event) => {
      preventDefaults(event);
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsGlobalDragging(false);
      }
    };

    const handleDrop = (event) => {
      preventDefaults(event);
      dragDepthRef.current = 0;
      setIsGlobalDragging(false);
      const droppedFiles = getValidatedFiles(
        extractDropFiles(event.dataTransfer?.files),
        extractedDocs.length
      );
      if (droppedFiles.length > 0) {
        setSelectedFiles(droppedFiles);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [extractedDocs.length, isGlobalDragging]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
  }, [messages, loadingChat, waitingFirstToken, isStreaming]);

  const activeDocuments = useMemo(
    () => extractedDocs.filter((doc) => activeDocIds.includes(doc.id)),
    [extractedDocs, activeDocIds]
  );
  const activeSelectionKey = useMemo(() => {
    if (!activeDocIds.length) return "";
    return [...activeDocIds].sort().join("::");
  }, [activeDocIds]);
  const activeDocumentText = useMemo(
    () => buildCombinedDocumentText(activeDocuments).trim(),
    [activeDocuments]
  );
  const activeConversationHistory = useMemo(() => {
    if (!activeSelectionKey) return [];
    return conversationHistoryBySelection[activeSelectionKey] || [];
  }, [conversationHistoryBySelection, activeSelectionKey]);
  const isReadyForChat = useMemo(() => activeDocumentText.length > 0, [activeDocumentText]);

  const appendMessage = (role, content, meta = null) => {
    setMessages((prev) => [...prev, { role, content, meta }]);
  };

  const appendAssistantToken = (token) => {
    setMessages((prev) => {
      if (prev.length === 0) {
        return [...prev, { role: "assistant", content: stripInstructionEcho(token) }];
      }

      const next = [...prev];
      const lastIndex = next.length - 1;
      const last = next[lastIndex];

      if (last.role === "assistant") {
        const merged = `${last.content}${token}`;
        next[lastIndex] = { ...last, content: stripInstructionEcho(merged) };
      } else {
        next.push({ role: "assistant", content: stripInstructionEcho(token) });
      }

      return next;
    });
  };

  const toggleFileMessage = (messageKey) => {
    setExpandedFileMessages((prev) => ({
      ...prev,
      [messageKey]: !prev[messageKey],
    }));
  };

  const toggleActiveDoc = (docId) => {
    setActiveDocIds((prev) => {
      if (prev.includes(docId)) {
        return prev.filter((id) => id !== docId);
      }
      return [...prev, docId];
    });
  };

  const handleExtract = async () => {
    if (!selectedFiles.length) {
      appendMessage("assistant", "먼저 PDF 파일을 선택해 주세요.");
      return;
    }

    if (selectedFiles.length > MAX_EXTRACT_DOCS || extractedDocs.length + selectedFiles.length > MAX_EXTRACT_DOCS) {
      toast.error("문서 추출은 5개까지만 가능합니다.");
      return;
    }

    if (
      selectedOcrModel === "pypdf2" &&
      selectedFiles.some((f) => getFileExtension(f.name) !== ".pdf")
    ) {
      toast.error("pypdf2 모델은 PDF 파일만 지원합니다.");
      return;
    }

    setLoadingExtract(true);
    appendMessage(
      "assistant",
      `문서 텍스트를 추출하고 있습니다. 잠시만 기다려 주세요... (${selectedFiles.length}개)`
    );

    try {
      const extractedBatch = [];

      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("ocr_model", selectedOcrModel);
        formData.append("current_doc_count", String(extractedDocs.length + extractedBatch.length));

        const response = await fetch(`${API_BASE}/documents/extract-chat`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        if (!response.ok) {
          const errorMsg = normalizeErrorMessage(data?.detail, "텍스트 추출 중 오류가 발생했습니다.");
          appendMessage("assistant", `${file.name}: ${errorMsg}`);
          continue;
        }

        const extracted = (data.extracted_text || "").trim();
        const docId = createDocId();
        extractedBatch.push({
          id: docId,
          fileName: data.filename || file.name,
          text: extracted,
        });
        appendMessage("assistant", "파일 텍스트 추출이 완료되었습니다.", {
          type: "file",
          fileName: data.filename || file.name,
          fileSize: formatFileSize(file.size),
          extractedText: extracted,
        });
      }

      if (extractedBatch.length > 0) {
        setExtractedDocs((prev) => [...prev, ...extractedBatch]);
        setActiveDocIds((prev) => {
          const next = [...prev];
          extractedBatch.forEach((doc) => {
            if (!next.includes(doc.id)) {
              next.push(doc.id);
            }
          });
          return next;
        });
      }
      setSelectedFiles([]);
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

    if (!isReadyForChat || activeDocuments.length === 0) {
      appendMessage("assistant", "먼저 문서를 추출하고 질문할 문서를 1개 이상 선택해 주세요.");
      return;
    }

    setLoadingChat(true);
    setWaitingFirstToken(true);
    setIsStreaming(false);
    try {
      appendMessage("assistant", "");
      let streamedAnswer = "";

      const response = await fetch(`${API_BASE}/documents/chat-summarize/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_text: activeDocumentText,
          instruction,
          model: selectedModel,
          user_id: userDbId ? parseInt(userDbId, 10) : null,
          use_rag: useRag,
          use_lora: useLora,
          conversation_history: activeConversationHistory,
        }),
      });
      if (!response.ok) {
        setWaitingFirstToken(false);
        const data = await response.json().catch(() => ({}));
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.length - 1;
          if (idx >= 0 && next[idx].role === "assistant") {
            next[idx] = {
              ...next[idx],
              content: normalizeErrorMessage(data?.detail, "응답 생성 중 오류가 발생했습니다."),
            };
          }
          return next;
        });
        return;
      }

      if (!response.body) {
        setWaitingFirstToken(false);
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.length - 1;
          if (idx >= 0 && next[idx].role === "assistant" && !next[idx].content) {
            next[idx] = { ...next[idx], content: "스트리밍 응답을 받을 수 없습니다." };
          }
          return next;
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const applySsePayload = (payload) => {
        if (payload.type === "token" && payload.text) {
          streamedAnswer += payload.text;
          setWaitingFirstToken(false);
          setIsStreaming(true);
          appendAssistantToken(payload.text);
          return false;
        }

        if (payload.type === "done") {
          setWaitingFirstToken(false);
          setIsStreaming(false);
          const resolvedAnswer = (payload.answer || streamedAnswer || "").trim();

          if (resolvedAnswer && activeSelectionKey) {
            setConversationHistoryBySelection((prev) => {
              const previousHistory = prev[activeSelectionKey] || [];
              const nextHistory = [
                ...previousHistory,
                { role: "user", content: instruction },
                { role: "assistant", content: resolvedAnswer },
              ].slice(-20);
              return {
                ...prev,
                [activeSelectionKey]: nextHistory,
              };
            });
          }

          if (payload.answer) {
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.length - 1;
              if (idx >= 0 && next[idx].role === "assistant" && !next[idx].content.trim()) {
                next[idx] = {
                  ...next[idx],
                  content: stripInstructionEcho(payload.answer),
                };
              }
              return next;
            });
          }
          return true;
        }

        if (payload.type === "error") {
          setWaitingFirstToken(false);
          setIsStreaming(false);
          setMessages((prev) => {
            const next = [...prev];
            const idx = next.length - 1;
            if (idx >= 0 && next[idx].role === "assistant") {
              next[idx] = {
                ...next[idx],
                content: normalizeErrorMessage(payload?.detail, "응답 생성 중 오류가 발생했습니다."),
              };
            }
            return next;
          });
          return true;
        }

        return false;
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventChunk of events) {
          const lines = eventChunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          if (!lines.length) continue;

          let payload;
          try {
            payload = JSON.parse(lines.join("\n"));
          } catch {
            continue;
          }

          if (applySsePayload(payload)) {
            return;
          }
        }
      }

      const trailingLines = buffer
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (trailingLines.length) {
        try {
          const trailingPayload = JSON.parse(trailingLines.join("\n"));
          if (applySsePayload(trailingPayload)) {
            return;
          }
        } catch {
          // ignore trailing parse errors
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === "assistant" && !next[idx].content.trim()) {
          next[idx] = { ...next[idx], content: "응답이 비어 있습니다." };
        }
        return next;
      });
    } catch (error) {
      setWaitingFirstToken(false);
      setIsStreaming(false);
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx >= 0 && next[idx].role === "assistant") {
          const fallback = next[idx].content?.trim()
            ? `${next[idx].content}\n\n요청 실패: ${error.message}`
            : `요청 실패: ${error.message}`;
          next[idx] = { ...next[idx], content: fallback };
        } else {
          next.push({ role: "assistant", content: `요청 실패: ${error.message}` });
        }
        return next;
      });
    } finally {
      setLoadingChat(false);
      setWaitingFirstToken(false);
      setIsStreaming(false);
    }
  };

  return (
    <div className="chat-summary-wrap">
      {isGlobalDragging && (
        <div className="global-drop-overlay" aria-hidden="true">
          <div className="global-drop-content">파일을 여기에 놓으면 업로드됩니다.</div>
        </div>
      )}
      <aside className="chat-panel">
        <h2>대화형 요약</h2>
        <p>파일을 추출한 뒤 원하는 방식으로 질문하세요.</p>

        <label className="upload-box">
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.hwpx,.jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff,.gif"
            onChange={(e) =>
              setSelectedFiles(getValidatedFiles(extractDropFiles(e.target.files), extractedDocs.length))
            }
          />
          {!selectedFiles.length && <span>파일 선택 또는 화면 어디든 드래그앤드롭 (최대 5개)</span>}
          {selectedFiles.length > 0 && (
            <>
              {selectedFiles.map((file) => (
                <div className="selected-file-card" key={`selected-${file.name}-${file.size}`}>
                  <div className="selected-file-icon" aria-hidden="true">📄</div>
                  <div className="selected-file-meta">
                    <div className="selected-file-name">{file.name}</div>
                    <div className="selected-file-size">{formatFileSize(file.size)}</div>
                  </div>
                </div>
              ))}
              <div className="selected-file-size">선택됨: {selectedFiles.length} / {MAX_EXTRACT_DOCS}</div>
            </>
          )}
          {extractedDocs.length > 0 && (
            <div className="selected-file-size">
              추출 완료 문서: {extractedDocs.length} / {MAX_EXTRACT_DOCS}
            </div>
          )}
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

        <button type="button" className="primary-btn" onClick={handleExtract} disabled={loadingExtract}>
          {loadingExtract ? "추출 중..." : "문서 텍스트 추출"}
        </button>

        {extractedDocs.length > 0 && (
          <div className="doc-switcher">
            <div className="doc-switcher-title">질문할 문서 선택</div>
            {extractedDocs.map((doc, index) => {
              const isActive = activeDocIds.includes(doc.id);
              return (
                <button
                  key={doc.id || `${doc.fileName}-${index}`}
                  type="button"
                  className={`doc-switcher-item ${isActive ? "active" : ""}`}
                  onClick={() => toggleActiveDoc(doc.id)}
                >
                  <span className="doc-switcher-name">{doc.fileName || `문서 ${index + 1}`}</span>
                  {isActive && <span className="doc-switcher-badge">선택됨</span>}
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <section className="chat-window">
        <div className="active-doc-banner">
          {activeDocuments.length > 0
            ? `현재 질문 대상 문서: ${activeDocuments.map((doc) => doc.fileName).join(", ")}`
            : "현재 질문 대상 문서가 없습니다. 왼쪽에서 문서를 선택해 주세요."}
        </div>

        <div className="messages" ref={messagesContainerRef}>
          {messages.map((msg, idx) => (
            <div key={`${msg.role}-${idx}`} className={`bubble ${msg.role}`}>
              {msg.content}
              {msg.meta?.type === "file" && (
                <>
                  <div className="message-file-card">
                    <div className="message-file-icon" aria-hidden="true">📄</div>
                    <div className="message-file-meta">
                      <div className="message-file-name">{msg.meta.fileName}</div>
                      <div className="message-file-size">{msg.meta.fileSize}</div>
                    </div>
                  </div>
                  {msg.meta.extractedText && (
                    <div className="message-file-detail">
                      <button
                        type="button"
                        className="message-file-toggle-btn"
                        onClick={() => toggleFileMessage(`msg-${idx}`)}
                      >
                        {expandedFileMessages[`msg-${idx}`] ? "원문 접기 ▲" : "원문 펼치기 ▼"}
                      </button>
                      {expandedFileMessages[`msg-${idx}`] && (
                        <div className="message-file-text">{msg.meta.extractedText}</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {loadingChat && waitingFirstToken && (
            <div className="thinking-indicator" role="status" aria-live="polite">
              <span className="thinking-dot" aria-hidden="true" />생각 중입니다
            </div>
          )}
          {loadingChat && !waitingFirstToken && isStreaming && (
            <div className="thinking-indicator" role="status" aria-live="polite">
              <span className="thinking-dot" aria-hidden="true" />답변 중입니다
            </div>
          )}
        </div>

        <div className="chat-input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeDocuments.length > 0
                ? `${activeDocuments.map((doc) => doc.fileName).join(", ")}에 대해 질문해 주세요`
                : "예: 핵심 포인트 3개만 bullet로 정리해줘"
            }
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
