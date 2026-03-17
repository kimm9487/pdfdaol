import React from "react";

const Modals = ({
  isModalOpen,
  selectedDoc,
  closeModal,
  isPasswordModalOpen,
  setIsPasswordModalOpen,
  passwordInput,
  setPasswordInput,
  handlePasswordSubmit,
}) => {
  return (
    <>
      {/* 요약 상세 모달 */}
      {isModalOpen && selectedDoc && (
        <div className="custom-modal-overlay" onClick={closeModal}>
          <div
            className="custom-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="custom-modal-header">
              <h2>문서 상세 내용</h2>
              <button className="custom-close-btn" onClick={closeModal}>
                ×
              </button>
            </div>
            <div className="custom-modal-body">
              <pre className="modal-text modal-original-text">
                {selectedDoc.extracted_text || "원본 텍스트가 없습니다."}
              </pre>
              <hr />
              <pre className="modal-text modal-summary-text">
                {selectedDoc.summary || "요약 내용이 없습니다."}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 입력 모달 */}
      {isPasswordModalOpen && (
        <div
          className="modal-overlay password-modal-overlay"
          onClick={() => setIsPasswordModalOpen(false)}
        >
          <div
            className="modal-content password-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close password-modal-close"
              onClick={() => {
                setPasswordInput("");
                setIsPasswordModalOpen(false);
              }}
            >
              ×
            </button>
            <h2>비밀번호 입력</h2>
            <p>중요 문서입니다. 4자리 비밀번호를 입력하세요.</p>
            <input
              type="password"
              maxLength={4}
              value={passwordInput}
              onChange={(e) =>
                setPasswordInput(e.target.value.replace(/\D/g, ""))
              }
              placeholder="••••"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handlePasswordSubmit();
                }
              }}
            />
            <button onClick={handlePasswordSubmit}>확인</button>
          </div>
        </div>
      )}
    </>
  );
};

export default Modals;