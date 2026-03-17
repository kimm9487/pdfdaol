import React, { useState, useEffect } from "react";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

const EditSummaryModal = ({ show, onClose, onSave, document }) => {
  const [fileName, setFileName] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [summary, setSummary] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  const [docPassword, setDocPassword] = useState("");

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
              <input
                type="text"
                maxLength="4"
                value={docPassword}
                onChange={(e) =>
                  setDocPassword(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="비밀번호 4자리 입력"
                className="form-input"
                style={{ border: "1px solid #fc8181", marginTop: "5px" }}
              />
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