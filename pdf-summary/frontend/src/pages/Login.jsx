import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./Login.css";

const Login = ({ setIsLoggedIn }) => {
  const [userId, setUserId] = useState("");
  const [userPw, setUserPw] = useState("");
  const [error, setError] = useState("");

  // 모달 및 인증 상태
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

  const navigate = useNavigate();

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

  // 로그인 처리
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("user_pw", userPw);

      const response = await fetch("http://localhost:8000/auth/login", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();

        // 1. 서버에서 내려주는 고유 번호(PK)를 반드시 저장해야 합니다.
        // 보통 DB의 id값은 data.id 또는 data.user_db_id 등으로 들어옵니다.
        localStorage.setItem("userDbId", data.id);

        localStorage.setItem("userName", data.full_name || data.user_name);
        localStorage.setItem("userId", data.username || data.user_id);
        localStorage.setItem("userRole", data.role); // 관리자 여부 확인용
        localStorage.setItem("isLoggedIn", "true");

        if (setIsLoggedIn) setIsLoggedIn(true);
        alert(`${data.full_name || data.user_name}님 환영합니다!`);
        navigate("/");
      } else {
        const errorData = await response.json();
        setError(errorData.detail || "로그인 실패");
      }
    } catch (err) {
      setError("서버 연결 실패");
    }
  };

  // 1. 인증번호 발송
  const handleSendCode = async () => {
    const endpoint =
      showModal === "id"
        ? "http://localhost:8000/auth/send-code-find-id"
        : "http://localhost:8000/auth/send-code-reset-pw";

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

  // 2. 인증번호 확인
  const handleVerifyCode = async () => {
    const formData = new FormData();
    formData.append("email", email);
    formData.append("code", verificationCode);

    try {
      const response = await fetch("http://localhost:8000/auth/verify-code", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        if (showModal === "id") {
          const idRes = await fetch(
            "http://localhost:8000/auth/verify-find-id",
            { method: "POST", body: formData },
          );
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

  // 3. 아이디 찾기 성공 후 바로 비밀번호 재설정으로 전환하는 함수
  const handleGoToResetPw = () => {
    setFindPwUserId(foundUsername); // 찾은 아이디를 재설정 필드에 자동 입력
    setFoundUsername(""); // 아이디 찾기 결과창 닫기
    setShowModal("pw"); // 모달 모드를 비밀번호 재설정으로 변경
    setIsVerified(true); // 이미 이메일 인증이 완료되었으므로 바로 비번 입력창 노출
  };

  // 4. 비밀번호 최종 재설정
  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword)
      return alert("비밀번호가 일치하지 않습니다.");

    const formData = new FormData();
    formData.append("email", email);
    formData.append("new_password", newPassword);
    formData.append("confirm_password", confirmPassword);

    try {
      const response = await fetch(
        "http://localhost:8000/auth/reset-password",
        {
          method: "POST",
          body: formData,
        },
      );
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

  return (
    <div className="login-body">
      <div className="login-container">
        <h2>PDF Summary</h2>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>아이디</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>비밀번호</label>
            <input
              type="password"
              value={userPw}
              onChange={(e) => setUserPw(e.target.value)}
              required
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit">로그인</button>
        </form>

        <div className="footer-links">
          <p>
            계정이 없으신가요? <Link to="/register">회원가입</Link>
          </p>
          <div className="find-links">
            <span
              onClick={() => setShowModal("id")}
              style={{ cursor: "pointer" }}
            >
              아이디 찾기
            </span>
            <span style={{ margin: "0 10px" }}>|</span>
            <span
              onClick={() => setShowModal("pw")}
              style={{ cursor: "pointer" }}
            >
              비밀번호 찾기
            </span>
          </div>
        </div>
      </div>

      {showModal && (
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
                  style={{
                    marginBottom: "15px",
                    fontSize: "14px",
                    color: "#666",
                  }}
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
      )}
    </div>
  );
};

export default Login;
