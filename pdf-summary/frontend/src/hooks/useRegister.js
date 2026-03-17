// src/hooks/useRegister.js
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildApiUrl } from "../config/api";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

export const useRegister = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialEmail = searchParams.get("email") || "";
  const initialName = searchParams.get("name") || "";
  const initialProvider = searchParams.get("provider") || "local";

  const [formData, setFormData] = useState({
    user_id: "",
    user_pw: "",
    user_pw_confirm: "",
    user_name: initialName,
    user_email: initialEmail,
  });
  const [provider] = useState(initialProvider); // 소셜 로그인 제공자 상태 추가

  const [emailCode, setEmailCode] = useState("");
  const [isCodeSent, setIsCodeSent] = useState(false);

  const [isEmailVerified, setIsEmailVerified] = useState(
    initialProvider === "google",
  ); // 구글 소셜 로그인은 이메일이 이미 검증된 것으로 간주

  const [timeLeft, setTimeLeft] = useState(300);
  const [error, setError] = useState("");
  const [idMessage, setIdMessage] = useState({ text: "", type: "" });

  // 5분 타이머 로직
  useEffect(() => {
    let timer;
    if (isCodeSent && !isEmailVerified && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    } else if (timeLeft === 0) {
      setIsCodeSent(false);
    }
    return () => clearInterval(timer);
  }, [isCodeSent, isEmailVerified, timeLeft]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (e.target.name === "user_id") setIdMessage({ text: "", type: "" });
    if (e.target.name === "user_email") {
      setIsCodeSent(false);
      setIsEmailVerified(false);
    }
  };

  const handleCheckId = async () => {
    if (!formData.user_id) return toast.error("아이디를 입력해주세요.");
    try {
      const response = await fetch(
        buildApiUrl(`/auth/check-id?user_id=${formData.user_id}`),
      );
      const data = await response.json();
      setIdMessage({
        text: data.message,
        type: data.available ? "success" : "error",
      });
    } catch (err) {
      toast.error("서버와 연결할 수 없습니다.");
    }
  };

  const handleSendCode = async () => {
    if (!formData.user_email) return toast.error("이메일을 입력해주세요.");
    try {
      const form = new FormData();
      form.append("email", formData.user_email);
      const response = await fetch(buildApiUrl("/auth/send-signup-code"), {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (response.ok) {
        setIsCodeSent(true);
        setTimeLeft(300);
        toast.success(data.message);
      } else {
        toast.error(data.detail || "메일 발송에 실패했습니다.");
      }
    } catch (err) {
      toast.error("서버와 연결할 수 없습니다.");
    }
  };

  const handleVerifyCode = async () => {
    if (!emailCode) return toast.error("인증번호를 입력해주세요.");
    try {
      const form = new FormData();
      form.append("email", formData.user_email);
      form.append("code", emailCode);
      const response = await fetch(buildApiUrl("/auth/verify-signup-code"), {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (response.ok) {
        setIsEmailVerified(true);
        setIsCodeSent(false);
        toast.success(data.message);
      } else {
        toast.error(data.detail || "인증 실패");
      }
    } catch (err) {
      toast.error("서버와 연결할 수 없습니다.");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (formData.user_pw !== formData.user_pw_confirm)
      return setError("비밀번호가 일치하지 않습니다.");
    if (idMessage.type !== "success")
      return setError("아이디 중복 확인이 필요합니다.");
    if (!isEmailVerified) return setError("이메일 인증을 완료해주세요.");

    const dataToSend = new FormData();
    dataToSend.append("user_id", formData.user_id);
    dataToSend.append("user_pw", formData.user_pw);
    dataToSend.append("user_name", formData.user_name);
    dataToSend.append("user_email", formData.user_email);
    dataToSend.append("provider", provider); // 소셜 로그인 제공자 정보도 함께 전송
    try {
      const response = await fetch(buildApiUrl("/auth/register"), {
        method: "POST",
        body: dataToSend,
      });
      if (response.ok) {
        toast.success("회원가입이 완료되었습니다!");
        navigate("/login");
      } else {
        const result = await response.json();
        setError(result.detail || "회원가입에 실패했습니다.");
      }
    } catch (err) {
      setError("서버와 연결할 수 없습니다.");
    }
  };

  return {
    formData,
    emailCode,
    setEmailCode,
    isCodeSent,
    isEmailVerified,
    timeLeft,
    error,
    idMessage,
    provider,
    formatTime,
    handleChange,
    handleCheckId,
    handleSendCode,
    handleVerifyCode,
    handleRegister,
  };
};