// src/pages/Login/index.jsx
import React from "react";
import { useLogin } from "../../hooks/useLogin";
import LoginForm from "./LoginForm";
import FindAccountModal from "./FindAccountModal";
import "./style.css";

const Login = ({ setIsLoggedIn }) => {
  const loginLogic = useLogin(setIsLoggedIn);

  return (
    <div className="login-body">
      <div className="login-container">
        <h2 className="main-title">PDF Summary</h2>

        <LoginForm
          userId={loginLogic.userId}
          setUserId={loginLogic.setUserId}
          userPw={loginLogic.userPw}
          setUserPw={loginLogic.setUserPw}
          error={loginLogic.error}
          handleLogin={loginLogic.handleLogin}
          setShowModal={loginLogic.setShowModal}
          handleGoogleLogin={loginLogic.handleGoogleLogin}
          handleNaverLogin={loginLogic.handleNaverLogin}
          handleKakaoLogin={loginLogic.handleKakaoLogin}
        />
      </div>

      <FindAccountModal
        showModal={loginLogic.showModal}
        email={loginLogic.email}
        setEmail={loginLogic.setEmail}
        findPwUserId={loginLogic.findPwUserId}
        setFindPwUserId={loginLogic.setFindPwUserId}
        verificationCode={loginLogic.verificationCode}
        setVerificationCode={loginLogic.setVerificationCode}
        isCodeSent={loginLogic.isCodeSent}
        isVerified={loginLogic.isVerified}
        foundUsername={loginLogic.foundUsername}
        newPassword={loginLogic.newPassword}
        setNewPassword={loginLogic.setNewPassword}
        confirmPassword={loginLogic.confirmPassword}
        setConfirmPassword={loginLogic.setConfirmPassword}
        resetModalState={loginLogic.resetModalState}
        handleSendCode={loginLogic.handleSendCode}
        handleVerifyCode={loginLogic.handleVerifyCode}
        handleGoToResetPw={loginLogic.handleGoToResetPw}
        handleResetPassword={loginLogic.handleResetPassword}
      />
    </div>
  );
};

export default Login;