import React, { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

const EditSummaryModal = ({ show, onClose, onSave, document }) => {
  const [fileName, setFileName] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [summary, setSummary] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  const [docPassword, setDocPassword] = useState("");

  // [2026-03-30 osj] PIN 입력 박스 ref 배열
  const pinRef0 = useRef(null);
  const pinRef1 = useRef(null);
  const pinRef2 = useRef(null);
  const pinRef3 = useRef(null);
  const pinRefs = [pinRef0, pinRef1, pinRef2, pinRef3];

  useEffect(() => {
    if (document) {
      setFileName(document.filename || "");
      setExtractedText(document.extracted_text || "");
      setSummary(document.summary || "");
      setIsImportant(document.is_important || false);
      setDocPassword(document.password || "");
    }
  }, [document]);

  const handleSave = () => {
    if (
      isImportant &&
      (docPassword.length !== 4 || !/^\d+$/.test(docPassword))
    ) {
      alert("중요 문서는 숫자 4자리 비밀번호가 필요합니다.");
      return;
    }
    onSave({
      docId: document.id,
      fileName,
      extractedText,
      summary,
      isImportant,
      password: isImportant ? docPassword : null,
    });
  };

  // [2026-03-30 osj] PIN 입력 박스 handlePinChange / handlePinKeyDown
  const handlePinChange = (index, value) => {
    const digit = value.replace(/[^0-9]/g, "").slice(-1);
    const arr = docPassword.padEnd(4, " ").split("");
    arr[index] = digit || " ";
    const next = arr.join("").replace(/ /g, "");
    setDocPassword(next);
    if (digit && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  };

  const handlePinKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      const arr = docPassword.padEnd(4, " ").split("");
      if (arr[index] && arr[index] !== " ") {
        arr[index] = " ";
        setDocPassword(arr.join("").replace(/ /g, ""));
      } else if (index > 0) {
        pinRefs[index - 1].current?.focus();
        const prev = docPassword.padEnd(4, " ").split("");
        prev[index - 1] = " ";
        setDocPassword(prev.join("").replace(/ /g, ""));
      }
    }
  };

  const handleClose = () => {
    onClose();
  };

  if (!show) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content modal-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>문서 정보 수정</h2>
        <div className="modal-body edit-modal-body">
          <div className="form-group">
            <label>파일명</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="파일명을 입력하세요"
              className="form-input"
            />
          </div>

          <div
            className="form-group"
            style={{
              marginBottom: "15px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <label
              style={{
                fontWeight: "bold",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                margin: 0,
              }}
            >
              <input
                type="checkbox"
                checked={isImportant}
                onChange={(e) => {
                  setIsImportant(e.target.checked);
                  if (!e.target.checked) setDocPassword("");
                }}
                style={{
                  width: "18px",
                  height: "18px",
                  marginRight: "8px",
                }}
              />
              🔒 이 문서를 중요 문서로 설정 (비밀번호 보호)
            </label>
          </div>

          {isImportant && (
            <div
              className="form-group password-edit-box"
              style={{
                backgroundColor: "#fff5f5",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #feb2b2",
              }}
            >
              <label
                style={{
                  color: "#c53030",
                  fontWeight: "bold",
                  display: "block",
                  marginBottom: "5px",
                }}
              >
                설정할 비밀번호 (숫자 4자리)
              </label>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "center",
                  marginTop: "12px",
                }}
              >
                {[0, 1, 2, 3].map((i) => (
                  <input
                    key={i}
                    ref={pinRefs[i]}
                    type="password"
                    inputMode="numeric"
                    maxLength="1"
                    value={docPassword[i] || ""}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "12px",
                      border: "1.5px solid #d1d5db",
                      fontSize: "24px",
                      textAlign: "center",
                      outline: "none",
                      caretColor: "transparent",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
                      transition: "border-color 0.15s",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "#c53030")}
                    onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>원문</label>
            <textarea
              className="form-textarea large-textarea"
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              placeholder="원문을 수정하세요"
              rows="8"
            />
          </div>

          <div className="form-group">
            <label>요약</label>
            <textarea
              className="summary-textarea"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="요약을 수정하세요"
              rows="8"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={handleClose}>
            취소
          </button>
          <button className="btn-confirm" onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditSummaryModal;