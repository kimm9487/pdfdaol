import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../config/api';

const DocumentList = () => {
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const loadDocuments = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE}/admin/documents?limit=1000`, {
                cache: 'no-store'
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
            setDocuments([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadDocuments();
    }, []);

    const totalPages = Math.ceil(documents.length / itemsPerPage);
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = documents.slice(indexOfFirstItem, indexOfLastItem);

    return (
        <section className="admin-card">
            <div className="card-header">
                <span>📄 문서 목록</span>
                <button className="btn-refresh" onClick={loadDocuments}>새로고침</button>
            </div>
            {error && <div className="error">오류: {error}</div>}
            {loading ? (
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
                                   <th>원문 추출 시간</th>
                                   <th>요약 상태</th>
                               </tr>
                           </thead>
                           <tbody>
                               {currentItems.map(doc => (
                                   <tr key={doc.id}>
                                       <td>{doc.id}</td>
                                       <td title={doc.filename}>{doc.filename}</td>
                                       <td>
                                           <span className="badge badge-info">
                                               {typeof doc.processing_times?.extraction === 'number' ? `${doc.processing_times.extraction.toFixed(1)}s` : '-'}
                                           </span>
                                       </td>
                                       <td>
                                           <span className={`badge${(doc.summary && doc.summary.trim()) ? ' badge-success' : ' badge-warning'}`}>
                                               {(doc.summary && doc.summary.trim()) ? '완료' : '요약안함'}
                                           </span>
                                           {(doc.summary && doc.summary.trim()) && typeof doc.processing_times?.summary === 'number' && (
                                               <div style={{ fontSize: '0.85em', color: '#666', marginTop: 2 }}>
                                                   (요약: {doc.processing_times.summary.toFixed(1)}s)
                                               </div>
                                           )}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                        </table>
                    </div>
                    
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
                                        if (i === 1 || i === totalPages - 2) {
                                            return <span key={`dots-${i}`} className="pagination-dots">...</span>;
                                        }
                                        return null;
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
                    
                    {documents.length > 0 && (
                        <div className="pagination-info">
                            <span>{currentPage} / {totalPages} 페이지</span>
                            <span>({documents.length}개 항목)</span>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};

export default DocumentList;
