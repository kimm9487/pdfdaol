// src/hooks/useLogin.js
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildApiUrl } from "../config/api";

export const useLogin = (setIsLoggedIn) => {
  const navigate = useNavigate();

  // 로그인 상태
  const [userId, setUserId] = useState("");
  const [userPw, setUserPw] = useState("");
  const [error, setError] = useState("");

  // 모달 및 인증 상태 (showModal: null | "id" | "pw")
  const [showModal, setShowModal] = useState(null);
  const [email, setEmail] = useState("");
  const [findPwUserId, setFindPwUserId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  // 찾기 결과 및 새 비번 상태
  const [foundUsername, setFoundUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 모달 초기화
  const resetModalState = () => {
    setShowModal(null);
    setEmail("");
    setFindPwUserId("");
    setVerificationCode("");
    setIsCodeSent(false);
    setIsVerified(false);
    setFoundUsername("");
    setNewPassword("");
    setConfirmPassword("");
  };

  // 🚀 1. 로그인 처리
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("user_pw", userPw);

      const response = await fetch(buildApiUrl("/auth/login"), {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("userName", data.user_name);
        localStorage.setItem("userId", data.user_id);
        localStorage.setItem("userDbId", data.user_db_id);
        localStorage.setItem("session_token", data.session_token);
        localStorage.setItem("isLoggedIn", "true");
        if (setIsLoggedIn) setIsLoggedIn(true);
        alert(`${data.user_name}님 환영합니다!`);
        navigate("/");
      } else {
        const errorData = await response.json();
        setError(errorData.detail || "로그인 실패");
      }
    } catch (err) {
      setError("서버 연결 실패");
    }
  };

  // 📧 2. 인증번호 발송 (아이디/비번 찾기 공통)
  const handleSendCode = async () => {
    const endpoint =
      showModal === "id"
        ? buildApiUrl("/auth/send-code-find-id")
        : buildApiUrl("/auth/send-code-reset-pw");

    const formData = new FormData();
    formData.append("email", email);
    if (showModal === "pw") {
      if (!findPwUserId) return alert("아이디를 입력해주세요.");
      formData.append("user_id", findPwUserId);
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        alert("인증번호가 발송되었습니다.");
        setIsCodeSent(true);
      } else {
        const data = await response.json();
        alert(data.detail);
      }
    } catch (err) {
      alert("서버 연결 실패");
    }
  };

  // ✅ 3. 인증번호 확인
  const handleVerifyCode = async () => {
    const formData = new FormData();
    formData.append("email", email);
    formData.append("code", verificationCode);

    try {
      const response = await fetch(buildApiUrl("/auth/verify-code"), {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        if (showModal === "id") {
          const idRes = await fetch(buildApiUrl("/auth/verify-find-id"), {
            method: "POST",
            body: formData,
          });
          const data = await idRes.json();
          setFoundUsername(data.username);
        } else {
          setIsVerified(true);
        }
      } else {
        const data = await response.json();
        alert(data.detail);
      }
    } catch (err) {
      alert("서버 연결 실패");
    }
  };

  // 🔄 4. 아이디 찾기 후 비밀번호 재설정으로 바로 넘어가기
  const handleGoToResetPw = () => {
    setFindPwUserId(foundUsername);
    setFoundUsername("");
    setShowModal("pw");
    setIsVerified(true);
  };

  // 🔐 5. 비밀번호 최종 재설정
  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword)
      return alert("비밀번호가 일치하지 않습니다.");

    const formData = new FormData();
    formData.append("email", email);
    formData.append("new_password", newPassword);
    formData.append("confirm_password", confirmPassword);

    try {
      const response = await fetch(buildApiUrl("/auth/reset-password"), {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        alert("비밀번호가 변경되었습니다. 다시 로그인해주세요.");
        resetModalState();
      } else {
        const data = await response.json();
        alert(data.detail);
      }
    } catch (err) {
      alert("서버 연결 실패");
    }
  };

  return {
    userId,
    setUserId,
    userPw,
    setUserPw,
    error,
    showModal,
    setShowModal,
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
    handleLogin,
    handleSendCode,
    handleVerifyCode,
    handleGoToResetPw,
    handleResetPassword,
  };
};
