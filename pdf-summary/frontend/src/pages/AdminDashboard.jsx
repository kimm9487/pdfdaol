import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionValidator } from '../hooks/useSessionValidator';
import { API_BASE, buildApiUrl } from '../config/api';
import './AdminDashboard.css';

const AdminDashboard = () => {
    // ===== [추가] 세션 유효성 검증 (useSessionValidator가 이미 처리함, 여기선 제거) =====

    const navigate = useNavigate();
    const userDbIdStr = localStorage.getItem('userDbId');
    const adminId = userDbIdStr ? parseInt(userDbIdStr) : null; // 관리자 ID
    
    console.log('AdminDashboard Init - userDbIdStr:', userDbIdStr, '파싱된 adminId:', adminId);

    // ===== [추가] 로그인 정보 확인 =====
    useEffect(() => {
      const userDbId = localStorage.getItem('userDbId');
      const sessionToken = localStorage.getItem('session_token');
      
      if (!userDbId || !sessionToken) {
        console.log('로그인 정보 없음, 로그인 페이지로 이동');
        navigate('/login');
        return;
      }
    }, []); // 마운트할 때 한 번만 실행
    
    const [dbStatus, setDbStatus] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [activeSessions, setActiveSessions] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [loading, setLoading] = useState({ db: true, docs: true, sessions: true, users: true });
    const [error, setError] = useState(null);

    // ===== [추가] 페이지네이션 상태 =====
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10; // 한 페이지에 10개씩 표시

    // ===== [추가] 페이지네이션 계산 =====
    const totalPages = Math.ceil(documents.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = documents.slice(indexOfFirstItem, indexOfLastItem);

    // 데이터베이스 상태 로드
    const loadDatabaseStatus = async () => {
        setLoading(prev => ({ ...prev, db: true }));
        try {
            const response = await fetch(`${API_BASE}/admin/database-status`, {
                cache: 'no-store'  // 캐시 비활성화
            });
            if (!response.ok) {
                throw new Error('DB 상태 확인 실패');
            }
            const data = await response.json();
            setDbStatus(data);
        } catch (err) {
            setError(err.message);
            console.error('DB 상태 로드 오류:', err);
        } finally {
            setLoading(prev => ({ ...prev, db: false }));
        }
    };

    // 문서 목록 로드
    const loadDocuments = async () => {
        setLoading(prev => ({ ...prev, docs: true }));
        setError(null);  // 이전 오류 초기화
        try {
            const response = await fetch(`${API_BASE}/admin/documents?limit=1000`, {
                cache: 'no-store'  // 캐시 비활성화
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 문서 목록 조회 실패`);
            }
            const data = await response.json();
            if (data && Array.isArray(data.documents)) {
                setDocuments(data.documents);
                setCurrentPage(1);
            } else {
                console.warn('예상치 못한 응답 형식:', data);
                throw new Error('응답 형식이 올바르지 않습니다');
            }
        } catch (err) {
            setError(err.message);
            console.error('문서 로드 오류:', err);
            setDocuments([]);  // 오류 시 문서 목록 초기화
        } finally {
            setLoading(prev => ({ ...prev, docs: false }));
        }
    };

    // 활성 사용자 세션 로드
    const loadActiveSessions = async () => {
        setLoading(prev => ({ ...prev, sessions: true }));
        try {
            const userId = localStorage.getItem('userDbId');
            const url = buildApiUrl(`/auth/admin/sessions?admin_user_id=${userId}`);
            console.log('loadActiveSessions - 요청 URL:', url);
            const response = await fetch(url, {
                cache: 'no-store'
            });
            console.log('loadActiveSessions - 응답 상태:', response.status, response.statusText);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 세션 조회 실패`);
            }
            const data = await response.json();
            console.log('loadActiveSessions - 응답 데이터:', data);
            if (Array.isArray(data.sessions)) {
                console.log('세션 배열 감지, 개수:', data.sessions.length);
                if (data.sessions.length > 0) {
                    console.log('첫 번째 세션 구조:', data.sessions[0]);
                }
                setActiveSessions(data.sessions);
            } else {
                console.warn('예상치 못한 응답 형식:', data);
                setActiveSessions([]);
            }
        } catch (err) {
            console.error('세션 로드 오류:', err);
            setActiveSessions([]);
        } finally {
            setLoading(prev => ({ ...prev, sessions: false }));
        }
    };

    // 강제 로그아웃
    const handleForceLogout = async (sessionId) => {
        if (!window.confirm('이 사용자를 강제 로그아웃하시겠습니까?')) {
            return;
        }
        try {
            const userId = localStorage.getItem('userDbId');
            console.log('handleForceLogout - sessionId:', sessionId, '타입:', typeof sessionId);
            console.log('handleForceLogout - userId:', userId);
            
            // 강제 로그아웃 대상의 user_id 찾기
            const targetSession = activeSessions.find(s => s.session_id === sessionId);
            const targetUserId = targetSession ? targetSession.user_id : null;
            console.log('handleForceLogout - 강제 로그아웃 대상 user_id:', targetUserId);
            
            const url = buildApiUrl(`/auth/admin/sessions/${sessionId}?admin_user_id=${userId}`);
            console.log('handleForceLogout - 최종 URL:', url);
            const response = await fetch(url, {
                method: 'DELETE'
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || `HTTP ${response.status}: 강제 로그아웃 실패`);
            }
            
            // 강제 로그아웃 대상을 sessionStorage에 저장 (대상 사용자가 즉시 감지하도록)
            if (targetUserId) {
                console.log(`대상 user_id ${targetUserId}를 감시 목록에 추가`);
                sessionStorage.setItem('terminatedUserId', targetUserId);
            }
            
            alert('해당 사용자를 강제 로그아웃했습니다.');
            loadActiveSessions();
        } catch (err) {
            alert('강제 로그아웃 실패: ' + err.message);
            console.error('강제 로그아웃 오류:', err);
        }
    };

    // 회원 목록 로드
    const loadAllUsers = async () => {
        setLoading(prev => ({ ...prev, users: true }));
        try {
            const response = await fetch(buildApiUrl('/auth/users'), {
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 회원 목록 조회 실패`);
            }
            const data = await response.json();
            if (Array.isArray(data)) {
                // 현재 로그인한 사용자(본인) 제외
                const currentUserId = parseInt(localStorage.getItem('userDbId'));
                const filteredUsers = data.filter(u => u.id !== currentUserId);
                setAllUsers(filteredUsers);
            } else {
                console.warn('예상치 못한 응답 형식:', data);
                setAllUsers([]);
            }
        } catch (err) {
            console.error('회원 목록 로드 오류:', err);
            setAllUsers([]);
        } finally {
            setLoading(prev => ({ ...prev, users: false }));
        }
    };

    // 회원 삭제
    const handleDeleteUser = async (userId, username) => {
        if (!window.confirm(`정말 사용자 '${username}'을(를) 삭제하시겠습니까?`)) {
            return;
        }
        try {
            const adminId = localStorage.getItem('userDbId');
            const formData = new FormData();
            formData.append('admin_user_id', adminId);

            const response = await fetch(buildApiUrl(`/auth/users/${userId}`), {
                method: 'DELETE',
                body: formData
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 회원 삭제 실패`);
            }
            alert('사용자가 삭제되었습니다.');
            setAllUsers(allUsers.filter(u => u.id !== userId));
        } catch (err) {
            alert('회원 삭제 실패: ' + err.message);
            console.error('회원 삭제 오류:', err);
        }
    };

    useEffect(() => {
        loadDatabaseStatus();
        loadDocuments();
        loadActiveSessions();
        loadAllUsers();
    }, []);

    return (
        <div className="admin-body">
            <header className="admin-header">
                <h1>📊 PDF 요약 시스템 - 관리자 대시보드</h1>
            </header>

            <div className="admin-container">
                {/* 데이터베이스 상태 카드 */}
                <section className="admin-card">
                    <div className="card-header">
                        <span>🔧 데이터베이스 상태</span>
                        <button className="btn-refresh" onClick={loadDatabaseStatus}>새로고침</button>
                    </div>
                    {loading.db ? (
                        <div className="loading">데이터베이스 상태를 확인하는 중...</div>
                    ) : dbStatus ? (
                        <div className="status-grid">
                            <div className="status-item success">
                                <h4>연결 상태</h4>
                                <p>{dbStatus.database_connection}</p>
                                <small>버전: {dbStatus.database_version}</small>
                            </div>
                            <div className={`status-item ${dbStatus.pdf_documents_table_exists ? 'success' : 'warning'}`}>
                                <h4>테이블 상태</h4>
                                <p>테이블 수: {dbStatus.tables.length}개</p>
                                <p>pdf_documents: {dbStatus.pdf_documents_table_exists ? '✅ 존재' : '⚠️ 없음'}</p>
                            </div>
                            {dbStatus.data_statistics && (
                                <div className="status-item">
                                    <h4>문서 통계</h4>
                                    <p>전체 문서: {dbStatus.data_statistics.total_documents}개</p>
                                </div>
                            )}
                        </div>
                    ) : <div className="error">데이터를 불러올 수 없습니다.</div>}
                </section>

                {/* 활성 사용자 세션 카드 */}
                <section className="admin-card">
                    <div className="card-header">
                        <span>👥 현재 로그인 중인 사용자</span>
                        <button className="btn-refresh" onClick={loadActiveSessions}>새로고침</button>
                    </div>
                    {loading.sessions ? (
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
                                    {activeSessions.map(session => (
                                        <tr key={session.session_id}>
                                            <td>{session.user_id}</td>
                                            <td>{session.username}</td>
                                            <td>{new Date(session.login_time).toLocaleString('ko-KR')}</td>
                                            <td>{session.ip_address}</td>
                                            <td className="device-info">{session.device}</td>
                                            <td>{new Date(session.expires_at).toLocaleString('ko-KR')}</td>
                                            <td>
                                                {session.user_id === adminId ? (
                                                    <span style={{ color: '#999', fontSize: '0.9rem' }}>본인 세션</span>
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

                {/* 회원 관리 카드 */}
                <section className="admin-card">
                    <div className="card-header">
                        <span>👤 회원 관리</span>
                        <button className="btn-refresh" onClick={loadAllUsers}>새로고침</button>
                    </div>
                    {loading.users ? (
                        <div className="loading">회원 목록을 불러오는 중...</div>
                    ) : allUsers.length === 0 ? (
                        <div className="loading">등록된 회원이 없습니다</div>
                    ) : (
                        <div className="table-container">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>사용자명</th>
                                        <th>이메일</th>
                                        <th>역할</th>
                                        <th>가입일</th>
                                        <th>작업</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allUsers.map(user => (
                                        <tr key={user.id}>
                                            <td>
                                                <strong>{user.full_name}</strong><br/>
                                                <small style={{ color: '#666' }}>@{user.username}</small>
                                            </td>
                                            <td>{user.email}</td>
                                            <td>
                                                <span className={`badge ${user.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                                                    {user.role === 'admin' ? '관리자' : '사용자'}
                                                </span>
                                            </td>
                                            <td>{user.created_at ? user.created_at.split(' ')[0] : '-'}</td>
                                            <td>
                                                <button 
                                                    className="btn-danger" 
                                                    onClick={() => handleDeleteUser(user.id, user.username)}
                                                >
                                                    삭제
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* 문서 목록 카드 */}
                <section className="admin-card">
                    <div className="card-header">
                        <span>📄 문서 목록</span>
                        <button className="btn-refresh" onClick={loadDocuments}>새로고침</button>
                    </div>
                    {error && <div className="error">오류: {error}</div>}
                    {loading.docs ? (
                        <div className="loading">목록을 불러오는 중...</div>
                    ) : documents.length === 0 ? (
                        <div className="loading">문서 목록이 없습니다</div>
                    ) : (
                        <>
                            <div className="table-container">
                                <table className="admin-table">
                                   <thead>
                                       <tr>
                                           <th>ID</th>
                                           <th>파일명</th>
                                           <th>원문번역</th>
                                           <th>요약번역</th>
                                           <th>처리시간</th>
                                       </tr>
                                   </thead>
                                   <tbody>
                                       {/* ===== [수정] documents → currentItems로 변경: 현재 페이지의 항목만 표시 ===== */}
                                       {currentItems.map(doc => (
                                           <tr key={doc.id}>
                                               <td>{doc.id}</td>
                                               <td title={doc.filename}>{doc.filename}</td>
                                               <td>
                                                   <span className={`badge ${doc.has_original_translation ? 'badge-success' : 'badge-danger'}`}>
                                                       {doc.has_original_translation ? '완료' : '미완료'}
                                                   </span>
                                               </td>
                                               <td>
                                                   <span className={`badge ${doc.has_summary_translation ? 'badge-success' : 'badge-danger'}`}>
                                                       {doc.has_summary_translation ? '완료' : '미완료'}
                                                   </span>
                                               </td>
                                               <td>
                                                   <small>요약: {doc.processing_times.summary?.toFixed(1)}s</small>
                                               </td>
                                           </tr>
                                       ))}
                                   </tbody>
                                </table>
                            </div>
                            
                            {/* ===== [추가] 페이지네이션 UI ===== */}
                            {documents.length > 0 && (
                                <div className="pagination">
                                    <button
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                        disabled={currentPage === 1}
                                    >
                                        ❮ 이전
                                    </button>

                                    <div className="pagination-numbers">
                                        {Array.from({ length: totalPages }, (_, i) => {
                                            const pageNum = i + 1;
                                            const isVisible = 
                                                pageNum === 1 || 
                                                pageNum === totalPages ||
                                                (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

                                            if (!isVisible && i !== 0 && i !== 1) {
                                                return null;
                                            }

                                            if (!isVisible && (i === 1 || i === totalPages - 2)) {
                                                return <span key={`dots-${i}`} className="pagination-dots">...</span>;
                                            }

                                            return (
                                                <button
                                                    key={pageNum}
                                                    className={`pagination-number ${currentPage === pageNum ? 'active' : ''}`}
                                                    onClick={() => setCurrentPage(pageNum)}
                                                >
                                                    {pageNum}
                                                </button>
                                            );
                                        }).filter(Boolean)}
                                    </div>

                                    <button
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                        disabled={currentPage === totalPages}
                                    >
                                        다음 ❯
                                    </button>
                                </div>
                            )}

                            {/* ===== [추가] 페이지 정보 표시 ===== */}
                            {documents.length > 0 && (
                                <div className="pagination-info">
                                    <span>{currentPage} / {totalPages} 페이지</span>
                                    <span>({documents.length}개 항목)</span>
                                </div>
                            )}
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default AdminDashboard;