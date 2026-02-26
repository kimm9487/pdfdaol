import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Header.css'; // 스타일 파일도 따로 만들면 깔끔해요!

function Header() {
  const navigate = useNavigate();
  // 로그인 상태를 관리할 state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');

  // 컴포넌트가 로드될 때 로그인 상태 확인
  useEffect(() => {
    const status = localStorage.getItem("isLoggedIn") === "true";
    const name = localStorage.getItem("userName");
    setIsLoggedIn(status);
    setUserName(name || '');
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userName");
    setIsLoggedIn(false);
    alert("로그아웃 되었습니다.");
    navigate("/");
    window.location.reload(); // 상태 업데이트를 위해 페이지 새로고침
  };

  return (
    <nav className="header-nav">
      <div className="header-logo">
        <Link to="/">PDF DAOL</Link>
      </div>
      <div className="header-menu">
        {isLoggedIn ? (
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