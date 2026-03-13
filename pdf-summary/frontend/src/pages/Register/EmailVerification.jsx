// pages/Register/EmailVerification.jsx
import React from "react";

const EmailVerification = ({
  formData,
  handleChange,
  emailCode,
  setEmailCode,
  isCodeSent,
  isEmailVerified,
  timeLeft,
  formatTime,
  handleSendCode,
  handleVerifyCode,
}) => {
  return (
    <>
      <div className="form-group">
        <label>이메일</label>
        <div className="input-group">
          <input
            type="email"
            name="user_email"
            placeholder="example@email.com"
            value={formData.user_email}
            onChange={handleChange}
            required
            disabled={isEmailVerified}
          />
          <button
            type="button"
            className={`btn-small ${isEmailVerified ? "btn-success" : ""}`}
            onClick={handleSendCode}
            disabled={isEmailVerified || (isCodeSent && timeLeft > 0)}
          >
            {isEmailVerified ? "인증완료" : isCodeSent ? "재전송" : "인증요청"}
          </button>
        </div>
      </div>

      {isCodeSent && !isEmailVerified && (
        <div className="form-group verify-group">
          <div className="input-group">
            <input
              type="text"
              placeholder="인증번호 6자리"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value)}
            />
            <button
              type="button"
              className="btn-small btn-verify"
              onClick={handleVerifyCode}
            >
              확인
            </button>
          </div>
          <p className="timer-text">
            남은 시간 : <span>{formatTime(timeLeft)}</span>
          </p>
        </div>
      )}
    </>
  );
};

export default EmailVerification;
