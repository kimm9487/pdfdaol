import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout } from '../hooks/useLogout';
import './Header.css';

function Header({ setIsLoggedIn }) {
  const navigate = useNavigate();
  // 로그인 상태를 관리할 state
  const [isLoggedInLocal, setIsLoggedInLocal] = useState(false);
  const [userName, setUserName] = useState('');

  // 로그아웃 Hook 사용
  const handleLogout = useLogout(setIsLoggedIn);

  // 컴포넌트가 로드될 때 로그인 상태 확인
  useEffect(() => {
    const status = localStorage.getItem("isLoggedIn") === "true";
    const name = localStorage.getItem("userName");
    setIsLoggedInLocal(status);
    setUserName(name || '');
  }, []);

  return (
    <nav className="header-nav">
      <div className="header-logo">
        <Link to="/">PDF DAOL</Link>
      </div>
      <div className="header-menu">
        {isLoggedInLocal ? (
          <>
            <span className="user-welcome"><b>{userName}</b>님 환영합니다</span>
            <button onClick={() => navigate("/mypage")} className="nav-btn">마이페이지</button>
            <button onClick={handleLogout} className="nav-btn logout">로그아웃</button>
          </>
        ) : (
          <>
            <button onClick={() => navigate("/login")} className="nav-btn">로그인</button>
            <button onClick={() => navigate("/register")} className="nav-btn register">회원가입</button>
          </>
        )}
      </div>
    </nav>
  );
}

export default Header;