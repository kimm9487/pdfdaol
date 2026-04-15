import React, { useEffect, useState } from 'react';
import { API_BASE } from '../../config/api';

const PaymentLogList = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const loadPaymentLogs = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE}/admin/documents/payment-logs?limit=1000`, {
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 결제 로그 조회 실패`);
            }
            const data = await response.json();
            if (data && Array.isArray(data.payment_logs)) {
                setLogs(data.payment_logs);
                setCurrentPage(1);
            } else {
                throw new Error('응답 형식이 올바르지 않습니다');
            }
        } catch (err) {
            setError(err.message);
            setLogs([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPaymentLogs();
    }, []);

    const totalPages = Math.max(1, Math.ceil(logs.length / itemsPerPage));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentItems = logs.slice(startIndex, startIndex + itemsPerPage);

    const formatDateTime = (iso) => {
        if (!iso) return '-';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    };

    const renderStatusBadge = (status) => {
        const normalized = String(status || '').toLowerCase();
        if (normalized === 'approved') {
            return <span className="badge badge-success">승인</span>;
        }
        if (normalized === 'pending') {
            return <span className="badge badge-warning">대기</span>;
        }
        if (normalized === 'canceled') {
            return <span className="badge badge-info">취소</span>;
        }
        return <span className="badge badge-danger">실패</span>;
    };

    return (
        <section className="admin-card">
            <div className="card-header">
                <span>💳 결제 로그</span>
                <button className="btn-refresh" onClick={loadPaymentLogs}>새로고침</button>
            </div>

            {error && <div className="error">오류: {error}</div>}

            {loading ? (
                <div className="loading">결제 로그를 불러오는 중...</div>
            ) : logs.length === 0 ? (
                <div className="loading">결제 로그가 없습니다.</div>
            ) : (
                <>
                    <div className="table-container">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>결제ID</th>
                                    <th>결제자</th>
                                    <th>문서</th>
                                    <th>금액</th>
                                    <th>상태</th>
                                    <th>결제시각</th>
                                    <th>주문번호</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentItems.map((log) => (
                                    <tr key={log.payment_id}>
                                        <td>{log.payment_id}</td>
                                        <td>
                                            {log.username}
                                            <div className="device-info">{log.full_name || '-'}</div>
                                        </td>
                                        <td>
                                            #{log.document_id} {log.filename}
                                        </td>
                                        <td>{Number(log.amount || 0).toLocaleString('ko-KR')}원</td>
                                        <td>{renderStatusBadge(log.status)}</td>
                                        <td>{formatDateTime(log.approved_at || log.created_at)}</td>
                                        <td className="device-info">{log.partner_order_id}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="pagination">
                        <button
                            className="pagination-btn"
                            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                        >
                            ❮ 이전
                        </button>

                        <div className="pagination-numbers">
                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter((pageNum) => {
                                    return (
                                        pageNum === 1 ||
                                        pageNum === totalPages ||
                                        (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                                    );
                                })
                                .map((pageNum) => (
                                    <button
                                        key={pageNum}
                                        className={`pagination-number ${currentPage === pageNum ? 'active' : ''}`}
                                        onClick={() => setCurrentPage(pageNum)}
                                    >
                                        {pageNum}
                                    </button>
                                ))}
                        </div>

                        <button
                            className="pagination-btn"
                            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                        >
                            다음 ❯
                        </button>
                    </div>

                    <div className="pagination-info">
                        <span>{currentPage} / {totalPages} 페이지</span>
                        <span>({logs.length}개 항목)</span>
                    </div>
                </>
            )}
        </section>
    );
};

export default PaymentLogList;
