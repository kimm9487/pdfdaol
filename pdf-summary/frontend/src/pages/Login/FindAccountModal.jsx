// src/pages/Login/FindAccountModal.jsx
import React from "react";

const FindAccountModal = ({
  showModal,
  email,
  setEmail,
  findPwUserId,
  setFindPwUserId,
  verificationCode,
  setVerificationCode,
  isCodeSent,
  isVerified,
  foundUsername,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  resetModalState,
  handleSendCode,
  handleVerifyCode,
  handleGoToResetPw,
  handleResetPassword,
}) => {
  if (!showModal) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>{showModal === "id" ? "아이디 찾기" : "비밀번호 재설정"}</h3>

        {showModal === "id" && foundUsername ? (
          /* 아이디 찾기 성공 화면 */
          <div className="result-box">
            <p>
              아이디: <strong>{foundUsername}</strong>
            </p>
            <button onClick={resetModalState}>로그인하러 가기</button>
            <button
              onClick={handleGoToResetPw}
              style={{ backgroundColor: "#4a90e2", marginTop: "10px" }}
            >
              비밀번호 재설정
            </button>
          </div>
        ) : isVerified ? (
          /* 2단계: 새 비밀번호 입력창 */
          <div className="step-2">
            <p
              style={{ marginBottom: "15px", fontSize: "14px", color: "#666" }}
            >
              새로운 비밀번호를 입력해주세요.
            </p>
            <input
              type="password"
              placeholder="새 비밀번호"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="비밀번호 확인"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <button onClick={handleResetPassword}>비밀번호 변경하기</button>
          </div>
        ) : (
          /* 1단계: 정보 입력 및 인증 */
          <div className="step-1">
            {showModal === "pw" && (
              <input
                type="text"
                placeholder="아이디 입력"
                value={findPwUserId}
                onChange={(e) => setFindPwUserId(e.target.value)}
                disabled={isCodeSent}
              />
            )}
            <input
              type="email"
              placeholder="이메일 입력"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isCodeSent}
            />

            {!isCodeSent ? (
              <button onClick={handleSendCode}>인증번호 발송</button>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="인증번호 6자리"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
                <button onClick={handleVerifyCode}>인증번호 확인</button>
              </>
            )}
          </div>
        )}
        <button className="close-btn" onClick={resetModalState}>
          닫기
        </button>
      </div>
    </div>
  );
};

export default FindAccountModal;
