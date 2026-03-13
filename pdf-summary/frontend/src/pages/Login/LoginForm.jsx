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
}) => {
  return (
    <>
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
    </>
  );
};

export default LoginForm;
