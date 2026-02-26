import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header'; // 방금 만든 헤더 불러오기
import Login from './pages/Login';
import Register from './pages/Register';
import PdfSummary from "./pages/PdfSummary.jsx";
import MyPage from './pages/MyPage.jsx';
import AdminDashboard from './pages/AdminDashboard';

function App() {
  return (
    <Router>
      <Header /> {/* 👈 모든 페이지 상단에 헤더가 나타납니다 */}
      <Routes>
        <Route path="/" element={<PdfSummary/>} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/mypage" element={<MyPage  />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </Router>
  );
}
export default App;