import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useState, useEffect } from "react";
import { Toaster } from "react-hot-toast";
import Header from "./components/Header";
import Login from "./pages/Login";
import Register from "./pages/Register";
import PdfSummary from "./pages/PdfSummary";
import HomeHub from "./pages/HomeHub";
import ChatSummary from "./pages/ChatSummary";
import MyPage from "./pages/MyPage"; // 이재윤 MyPage 컴포넌트 분리
import AdminDashboard from "./pages/AdminDashboard";
import UserList from "./pages/UserList"; // 정재훈 추가 (2026-02-27): 전체 요약/사용자 목록 조회 페이지 (관리자 전용)
import WebSocketChat from "./components/WebSocketChat";


function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    const logged = localStorage.getItem("isLoggedIn") === "true";
    console.log("🚀 App 초기화 - isLoggedIn:", logged);
    console.log("📦 localStorage:", localStorage.getItem("isLoggedIn"));
    return logged;
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const logged = localStorage.getItem("isLoggedIn") === "true";
      console.log("💾 localStorage 변경 감지 - isLoggedIn:", logged);
      setIsLoggedIn(logged);
    };

    const handleAuthStateChange = () => {
      const logged = localStorage.getItem("isLoggedIn") === "true";
      console.log("🔐 authStateChanged 이벤트 감지 - isLoggedIn:", logged);
      setIsLoggedIn(logged);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("authStateChanged", handleAuthStateChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("authStateChanged", handleAuthStateChange);
    };
  }, []);

  console.log("📊 현재 render - isLoggedIn:", isLoggedIn);

  // 보호된 라우트 컴포넌트
  const ProtectedRoute = ({ component: Component }) => {
    if (isLoggedIn) {
      return <Component />;
    } else {
      return <Navigate to="/login" replace />;
    }
  };

  // 공개 라우트 (로그인할 때만 접근 가능)
  const PublicRoute = ({ component: Component }) => {
    if (isLoggedIn) {
      return <Navigate to="/" replace />;
    } else {
      return <Component />;
    }
  };

  return (
    <Router>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: { fontSize: "16px", padding: "14px 20px", minWidth: "280px" },
        }}
      />

      {/* 실시간 채팅 위젯 */}
      <WebSocketChat />

      {isLoggedIn && <Header setIsLoggedIn={setIsLoggedIn} />}
      <Routes>
        {/* 공개 라우트 */}
        <Route
          path="/login"
          element={
            <PublicRoute
              component={() => <Login setIsLoggedIn={setIsLoggedIn} />}
            />
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute
              component={() => <Register setIsLoggedIn={setIsLoggedIn} />}
            />
          }
        />

        {/* 보호된 라우트 */}
        {/* 정재훈 추가 (2026-02-27) 
            - 경로: /userlist
            - 용도: 전체 요약 이력 조회 + 사용자 정보 포함 목록 (슬라이드 기준 UI 구현 예정)
            - 접근: 로그인 + 관리자 권한 사용자만 가능 (ProtectedRoute 적용)
            - 참고: 추후 role 기반 추가 제한 가능 */}
        <Route
          path="/userlist"
          element={<ProtectedRoute component={UserList} />}
        />
        <Route path="/" element={<ProtectedRoute component={HomeHub} />} />
        <Route
          path="/pdf-summary"
          element={<ProtectedRoute component={PdfSummary} />}
        />
        <Route
          path="/chat-summary"
          element={<ProtectedRoute component={ChatSummary} />}
        />
        <Route path="/mypage" element={<ProtectedRoute component={MyPage} />} />
        <Route
          path="/admin"
          element={<ProtectedRoute component={AdminDashboard} />}
        />
        {/* 기타 경로 처리 */}
        <Route
          path="*"
          element={<Navigate to={isLoggedIn ? "/" : "/login"} replace />}
        />
      </Routes>
    </Router>
  );
}
export default App;