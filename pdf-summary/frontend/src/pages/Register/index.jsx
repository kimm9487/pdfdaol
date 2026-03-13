// src/pages/Register/index.jsx
import React from "react";
import { Link } from "react-router-dom";
import { useRegister } from "../../hooks/useRegister"; // 커스텀 훅 임포트
import RegisterForm from "./RegisterForm";
import "./style.css";

const Register = () => {
  // 훅에서 필요한 모든 상태와 함수를 가져옴
  const {
    formData,
    emailCode,
    setEmailCode,
    isCodeSent,
    isEmailVerified,
    timeLeft,
    error,
    idMessage,
    formatTime,
    handleChange,
    handleCheckId,
    handleSendCode,
    handleVerifyCode,
    handleRegister,
  } = useRegister();

  // 자식 컴포넌트로 넘겨줄 props 묶음
  const emailProps = {
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
  };

  return (
    <div className="register-body">
      <div className="register-container">
        <h2>회원가입</h2>
        <p className="subtitle">PDF Summary 서비스 이용을 위해 가입해주세요.</p>

        <RegisterForm
          formData={formData}
          handleChange={handleChange}
          handleCheckId={handleCheckId}
          idMessage={idMessage}
          handleRegister={handleRegister}
          error={error}
          emailProps={emailProps}
        />

        <div className="footer-links">
          이미 계정이 있으신가요? <Link to="/login">로그인 페이지로</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
