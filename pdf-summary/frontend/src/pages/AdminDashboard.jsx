import React, { useState, useEffect } from 'react';
import './AdminDashboard.css';

const AdminDashboard = () => {
    const API_BASE = 'http://localhost:8000/api';
    const [dbStatus, setDbStatus] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState({ db: true, docs: true });
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

    useEffect(() => {
        loadDatabaseStatus();
        loadDocuments();
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
                                    <p>번역률: {dbStatus.data_statistics.translation_rate}</p>
                                </div>
                            )}
                        </div>
                    ) : <div className="error">데이터를 불러올 수 없습니다.</div>}
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