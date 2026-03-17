import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout } from '../hooks/useLogout';
import { buildApiUrl } from '../config/api';
import './Header.css';

function Header({ setIsLoggedIn }) {
  const navigate = useNavigate();
  // 로그인 상태를 관리할 state
  const [isLoggedInLocal, setIsLoggedInLocal] = useState(false);
  const [userName, setUserName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // 로그아웃 Hook 사용
  const handleLogout = useLogout(setIsLoggedIn);

  // 컴포넌트가 로드될 때 로그인 상태 확인
  useEffect(() => {
    const syncAuthState = async () => {
      const status = localStorage.getItem("isLoggedIn") === "true";
      const name = localStorage.getItem("userName");
      const userId = (localStorage.getItem("userId") || "").trim().toLowerCase();
      let role = (localStorage.getItem("userRole") || "").trim().toLowerCase();

      // userRole 이 아직 없는 기존 로그인 세션 대응
      if (status && !role) {
        const userDbId = localStorage.getItem("userDbId");
        if (userDbId) {
          try {
            const res = await fetch(buildApiUrl(`/auth/profile/${userDbId}`));
            if (res.ok) {
              const profile = await res.json();
              role = (profile?.role || "").trim().toLowerCase();
              if (role) {
                localStorage.setItem("userRole", role);
              }
            }
          } catch (err) {
            console.warn("role 조회 실패:", err);
          }
        }
      }

      setIsLoggedInLocal(status);
      setUserName(name || '');
      setIsAdmin(role === "admin" || userId === "admin");
    };

    syncAuthState();
    window.addEventListener("storage", syncAuthState);
    window.addEventListener("authStateChanged", syncAuthState);

    return () => {
      window.removeEventListener("storage", syncAuthState);
      window.removeEventListener("authStateChanged", syncAuthState);
    };
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
            <button onClick={() => navigate("/userlist")} className="nav-btn">요약 목록 보기</button>
            {isAdmin && (
              <button onClick={() => navigate("/admin")} className="nav-btn">관리자 대시보드</button>
            )}
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