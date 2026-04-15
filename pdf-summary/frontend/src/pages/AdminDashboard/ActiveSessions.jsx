import React, { useState, useEffect } from 'react';
import { buildApiUrl } from '../../config/api';
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

const ActiveSessions = () => {
  const [activeSessions, setActiveSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const adminId = parseInt(localStorage.getItem("userDbId"));

  const loadActiveSessions = async () => {
    setLoading(true);
    try {
      const userId = localStorage.getItem("userDbId");
      const url = buildApiUrl(`/auth/admin/sessions?admin_user_id=${userId}`);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: 세션 조회 실패`);
      }
      const data = await response.json();
      if (Array.isArray(data.sessions)) {
        setActiveSessions(data.sessions);
      } else {
        console.warn("예상치 못한 응답 형식:", data);
        setActiveSessions([]);
      }
    } catch (err) {
      console.error("세션 로드 오류:", err);
      setActiveSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleForceLogout = async (sessionId) => {
    if (!window.confirm("이 사용자를 강제 로그아웃하시겠습니까?")) {
      return;
    }
    try {
      const userId = localStorage.getItem("userDbId");
      const targetSession = activeSessions.find(
        (s) => s.session_id === sessionId,
      );
      const targetUserId = targetSession ? targetSession.user_id : null;

      const url = buildApiUrl(
        `/auth/admin/sessions/${sessionId}?admin_user_id=${userId}`,
      );
      const response = await fetch(url, { method: "DELETE" });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          data.detail || `HTTP ${response.status}: 강제 로그아웃 실패`,
        );
      }

      if (targetUserId) {
        sessionStorage.setItem("terminatedUserId", targetUserId);
      }

      alert("해당 사용자를 강제 로그아웃했습니다.");
      loadActiveSessions();
    } catch (err) {
      alert("강제 로그아웃 실패: " + err.message);
      console.error("강제 로그아웃 오류:", err);
    }
  };

  useEffect(() => {
    loadActiveSessions();
  }, []);

  return (
    <section className="admin-card">
      <div className="card-header">
        <span>👥 현재 로그인 중인 사용자</span>
        <button className="btn-refresh" onClick={loadActiveSessions}>
          새로고침
        </button>
      </div>
      {loading ? (
        <div className="loading">세션 목록을 불러오는 중...</div>
      ) : activeSessions.length === 0 ? (
        <div className="loading">로그인 중인 사용자가 없습니다</div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>사용자 ID</th>
                <th>사용자명</th>
                <th>로그인 시간</th>
                <th>IP 주소</th>
                <th>장치</th>
                <th>세션 만료</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.map((session) => (
                <tr key={session.session_id}>
                  <td>{session.user_id}</td>
                  <td>{session.username}</td>
                  <td>
                    {new Date(session.login_time).toLocaleString("ko-KR")}
                  </td>
                  <td>{session.ip_address}</td>
                  <td className="device-info">{session.device}</td>
                  <td>
                    {new Date(session.expires_at).toLocaleString("ko-KR")}
                  </td>
                  <td>
                    {session.user_id === adminId ? (
                      <span style={{ color: "#999", fontSize: "0.9rem" }}>
                        본인 세션
                      </span>
                    ) : (
                      <button
                        className="btn-danger"
                        onClick={() => handleForceLogout(session.session_id)}
                      >
                        강제 로그아웃
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default ActiveSessions;
