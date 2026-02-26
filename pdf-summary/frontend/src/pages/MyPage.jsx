import React, { useState, useEffect } from 'react';
import './MyPage.css';

const MyPage = () => {
  const [userInfo, setUserInfo] = useState({
    name: localStorage.getItem("userName") || "사용자",
    id: "loading...",
    email: "이메일 정보 없음"
  });
const handleDeleteAccount = async () => {
  if (window.confirm("정말로 탈퇴하시겠습니까? 모든 히스토리가 삭제됩니다.")) {
    try {
      const userId = localStorage.getItem("userId");
      const response = await fetch(`http://localhost:8000/auth/withdraw/${userId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        alert("회원 탈퇴가 완료되었습니다.");
        localStorage.clear(); // 모든 로그인 정보 삭제
        window.location.href = "/"; // 메인으로 이동
      } else {
        alert("탈퇴 처리 중 오류가 발생했습니다.");
      }
    } catch (error) {
      console.error("탈퇴 에러:", error);
    }
  }
};
  // 임시 데이터 (나중에 DB에서 가져올 부분)
  const [history, setHistory] = useState([
    { id: 1, date: '2026-02-26', fileName: '인공지능_트렌드_2026.pdf', model: 'gemma3:latest', status: '완료' },
    { id: 2, date: '2026-02-25', fileName: 'React_v19_변경사항.pdf', model: 'llama3:latest', status: '완료' },
  ]);

  return (
    <div className="mypage-container">
      <div className="mypage-content">
        {/* 왼쪽: 프로필 섹션 */}
        <aside className="profile-card">
          <div className="profile-image">
            {userInfo.name[0]}
          </div>
          <h2 className="user-name">{userInfo.name}님</h2>
          <p className="user-id">@{localStorage.getItem("userName")}</p>
          <hr />
          <div className="stats">
            <div className="stat-item">
              <span className="stat-label">총 요약 건수</span>
              <span className="stat-value">{history.length}건</span>
            </div>
          </div>
          <button className="edit-btn">프로필 수정</button>
          <button className="delete-account-btn" 
                  onClick={handleDeleteAccount}
          > 회원 탈퇴 </button>
        </aside>

        {/* 오른쪽: 활동 내역 섹션 */}
        <main className="history-section">
          <h3 className="section-title">최근 요약 히스토리</h3>
          <div className="history-table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>파일명</th>
                  <th>모델</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.date}</td>
                    <td className="file-name-cell">{item.fileName}</td>
                    <td><span className="model-tag">{item.model}</span></td>
                    <td><span className="status-badge">{item.status}</span></td>
                    <td>
                      <button className="action-btn view">보기</button>
                      <button className="action-btn delete">삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
};

export default MyPage;