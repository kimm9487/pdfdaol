// pages/Register/RegisterForm.jsx
import React from "react";
import EmailVerification from "./EmailVerification";

const RegisterForm = ({
  formData,
  handleChange,
  handleCheckId,
  idMessage,
  handleRegister,
  error,
  emailProps, // EmailVerification으로 전달될 props 모음
}) => {
  return (
    <form onSubmit={handleRegister}>
      <div className="form-group">
        <label>아이디</label>
        <div className="input-group">
          <input
            type="text"
            name="user_id"
            placeholder="아이디 입력"
            value={formData.user_id}
            onChange={handleChange}
            required
          />
          <button type="button" className="btn-small" onClick={handleCheckId}>
            중복확인
          </button>
        </div>
        {idMessage.text && (
          <p className={`id-check-msg ${idMessage.type}`}>{idMessage.text}</p>
        )}
      </div>

      <div className="form-group">
        <label>비밀번호</label>
        <input
          type="password"
          name="user_pw"
          placeholder="8자 이상 입력"
          value={formData.user_pw}
          onChange={handleChange}
          required
        />
      </div>

      <div className="form-group">
        <label>비밀번호 확인</label>
        <input
          type="password"
          name="user_pw_confirm"
          placeholder="비밀번호 다시 입력"
          value={formData.user_pw_confirm}
          onChange={handleChange}
          required
        />
      </div>

      <div className="form-group">
        <label>이름</label>
        <input
          type="text"
          name="user_name"
          placeholder="실명을 입력하세요"
          value={formData.user_name}
          onChange={handleChange}
          required
        />
      </div>

      {/* 이메일 인증 영역 */}
      <EmailVerification {...emailProps} />

      {error && <p className="error-msg">{error}</p>}

      <button type="submit" className="btn-submit">
        가입 완료
      </button>
    </form>
  );
};

export default RegisterForm;
