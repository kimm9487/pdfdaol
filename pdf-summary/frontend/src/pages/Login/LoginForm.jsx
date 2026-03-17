// src/pages/Login/LoginForm.jsx
import React from "react";
import { Link } from "react-router-dom";

const LoginForm = ({
  userId,
  setUserId,
  userPw,
  setUserPw,
  error,
  handleLogin,
  setShowModal,
  handleGoogleLogin,
  handleNaverLogin,
  handleKakaoLogin,
}) => {
  return (
    <div className="login-form-wrapper">
      {/* 상단 헤더 영역 */}
      <div className="login-header"></div>

      {/* 1. 일반 이메일/비밀번호 폼 (위로 이동) */}
      <form onSubmit={handleLogin}>
        <div className="form-group input-with-icon">
          <span className="input-icon">🆔</span>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID"
            required
          />
        </div>
        <div className="form-group input-with-icon">
          <span className="input-icon">🔒</span>
          <input
            type="password"
            value={userPw}
            onChange={(e) => setUserPw(e.target.value)}
            placeholder="Password"
            required
          />
        </div>
        {error && <p className="error-msg">{error}</p>}
        <button type="submit" className="login-submit-btn">
          Login
        </button>
      </form>

      {/* 2. 구분선 */}
      <div className="divider">
        <span className="divider-text">OR</span>
      </div>

      {/* 3. 소셜 로그인 버튼 영역 (아래로 이동 및 네이버 추가) */}
      <div className="social-login-container">
        <button
          className="social-btn google"
          onClick={handleGoogleLogin}
          type="button"
        >
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg"
            alt="Google"
          />
        </button>
        <button
          className="social-btn naver"
          onClick={handleNaverLogin}
          type="button"
        >
          <span className="naver-icon">N</span>
        </button>
        <button
          className="social-btn kakao"
          onClick={handleKakaoLogin}
          type="button"
        >
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/e/e3/KakaoTalk_logo.svg"
            alt="Kakao"
          />
        </button>
      </div>

      {/* 하단 링크 영역 */}
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
  );
};

export default LoginForm;