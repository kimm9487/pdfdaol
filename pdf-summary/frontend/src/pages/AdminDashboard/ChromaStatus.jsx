import React, { useEffect, useState } from 'react';
import { API_BASE } from '../../config/api';

const ChromaStatus = () => {
    const [chromaStatus, setChromaStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const loadChromaStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_BASE}/admin/chroma-status`, {
                cache: 'no-store',
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || 'Chroma 상태 확인 실패');
            }
            const data = await response.json();
            setChromaStatus(data);
        } catch (err) {
            setError(err.message || 'Chroma 상태 조회 실패');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadChromaStatus();
    }, []);

    return (
        <section className="admin-card">
            <div className="card-header">
                <span>🧠 Chroma VectorDB 상태</span>
                <button className="btn-refresh" onClick={loadChromaStatus}>새로고침</button>
            </div>

            {loading ? (
                <div className="loading">Chroma 상태를 확인하는 중...</div>
            ) : error ? (
                <div className="error">{error}</div>
            ) : (
                <>
                    <div className="status-grid">
                        <div className={`status-item ${chromaStatus?.connected ? 'success' : 'warning'}`}>
                            <h4>연결 상태</h4>
                            <p>{chromaStatus?.connected ? '✅ 연결 성공' : '⚠️ 연결 실패'}</p>
                            <small>URL: {chromaStatus?.base_url}</small>
                        </div>
                        <div className="status-item">
                            <h4>컬렉션</h4>
                            <p>총 {chromaStatus?.collection_count || 0}개</p>
                            <small>heartbeat: {String(chromaStatus?.heartbeat || '-')}</small>
                        </div>
                    </div>

                    <div className="table-container">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>컬렉션명</th>
                                    <th>저장 chunk 수</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(chromaStatus?.collections || []).length > 0 ? (
                                    chromaStatus.collections.map((col) => (
                                        <tr key={col.name}>
                                            <td>{col.name}</td>
                                            <td>{col.count >= 0 ? col.count : '조회 실패'}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={2}>아직 저장된 컬렉션이 없습니다.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
};

export default ChromaStatus;
