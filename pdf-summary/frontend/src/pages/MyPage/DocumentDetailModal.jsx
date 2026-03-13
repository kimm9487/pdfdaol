import React from "react";

const DocumentDetailModal = ({ show, onClose, document }) => {
  if (!show || !document) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{document.filename}</h2>
        <div className="modal-body document-detail">
          <div className="detail-section">
            <h3>📝 원문 요약</h3>
            <p>{document.summary}</p>
          </div>
          <div className="detail-section">
            <h3>📄 전체 추출 텍스트</h3>
            <div className="text-preview">{document.extracted_text}</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentDetailModal;
