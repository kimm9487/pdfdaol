import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Header from './components/Header';
import Login from './pages/Login';
import Register from './pages/Register';
import PdfSummary from "./pages/PdfSummary.jsx";
import MyPage from './pages/MyPage.jsx';
import AdminDashboard from './pages/AdminDashboard';

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

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
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
      {isLoggedIn && <Header setIsLoggedIn={setIsLoggedIn} />}
      <Routes>
        {/* 공개 라우트 */}
        <Route 
          path="/login" 
          element={<PublicRoute component={() => <Login setIsLoggedIn={setIsLoggedIn} />} />} 
        />
        <Route 
          path="/register" 
          element={<PublicRoute component={() => <Register setIsLoggedIn={setIsLoggedIn} />} />} 
        />

        {/* 보호된 라우트 */}
        <Route 
          path="/" 
          element={<ProtectedRoute component={PdfSummary} />} 
        />
        <Route 
          path="/mypage" 
          element={<ProtectedRoute component={MyPage} />} 
        />
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