import React, { useEffect, useState } from 'react';
import { API_BASE } from '../../config/api';

const ChromaStatus = () => {
    const [chromaStatus, setChromaStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState('count-desc');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const formatTimestamp = (raw) => {
        if (!raw) return '-';
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return raw;
        return date.toLocaleString('ko-KR', { hour12: false });
    };

    const parseCount = (count) => {
        if (typeof count === 'number' && Number.isFinite(count)) return count;
        if (typeof count === 'string') {
            const normalized = count.trim();
            if (!normalized) return null;
            const parsed = Number(normalized);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    };

    const getCollectionState = (count) => {
        const parsed = parseCount(count);
        if (parsed === null) return 'error';
        if (parsed === 0) return 'empty';
        return 'normal';
    };

    const getCollectionStateLabel = (state) => {
        if (state === 'normal') return '정상';
        if (state === 'empty') return '비어 있음';
        return '확인 필요';
    };

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
            setCurrentPage(1);
        } catch (err) {
            setError(err.message || 'Chroma 상태 조회 실패');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadChromaStatus();
    }, []);

    const collections = chromaStatus?.collections || [];
    const normalizedQuery = query.trim().toLowerCase();
    const filteredCollections = collections.filter((col) => {
        if (!normalizedQuery) return true;
        return (col?.name || '').toLowerCase().includes(normalizedQuery);
    });

    const sortedCollections = [...filteredCollections].sort((a, b) => {
        const countA = parseCount(a?.count);
        const countB = parseCount(b?.count);

        if (sortBy === 'name-asc') return (a?.name || '').localeCompare(b?.name || '', 'ko');
        if (sortBy === 'name-desc') return (b?.name || '').localeCompare(a?.name || '', 'ko');
        if (sortBy === 'count-asc') {
            if (countA === null && countB === null) return 0;
            if (countA === null) return 1;
            if (countB === null) return -1;
            return countA - countB;
        }

        if (countA === null && countB === null) return 0;
        if (countA === null) return 1;
        if (countB === null) return -1;
        return countB - countA;
    });

    const totalItems = sortedCollections.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
    const indexOfLastItem = safeCurrentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = sortedCollections.slice(indexOfFirstItem, indexOfLastItem);

    useEffect(() => {
        // 필터/정렬/갱신으로 현재 페이지가 범위를 벗어나면 보정
        if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [totalPages, safeCurrentPage]);

    const handleQueryChange = (value) => {
        setQuery(value);
        setCurrentPage(1);
    };

    const handleSortChange = (value) => {
        setSortBy(value);
        setCurrentPage(1);
    };

    const healthyCollections = collections.filter((col) => getCollectionState(col?.count) === 'normal').length;
    const emptyCollections = collections.filter((col) => getCollectionState(col?.count) === 'empty').length;
    const issueCollections = collections.filter((col) => getCollectionState(col?.count) === 'error').length;
    const totalChunks = collections.reduce((acc, col) => {
        const parsed = parseCount(col?.count);
        return parsed === null ? acc : acc + parsed;
    }, 0);

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
                            <h4>전체 저장량</h4>
                            <p>총 {totalChunks.toLocaleString('ko-KR')} chunk</p>
                            <small>컬렉션 {chromaStatus?.collection_count || 0}개</small>
                        </div>
                        <div className="status-item">
                            <h4>운영 상태 요약</h4>
                            <p>정상 {healthyCollections} / 빈 컬렉션 {emptyCollections}</p>
                            <small>확인 필요 {issueCollections}개</small>
                        </div>
                        <div className="status-item">
                            <h4>연결 지표</h4>
                            <p>총 {chromaStatus?.collection_count || 0}개</p>
                            <small>heartbeat: {String(chromaStatus?.heartbeat || '-')}</small>
                        </div>
                    </div>

                    <div className="chroma-table-toolbar">
                        <input
                            type="text"
                            className="chroma-search-input"
                            placeholder="컬렉션명 검색"
                            value={query}
                            onChange={(e) => handleQueryChange(e.target.value)}
                        />
                        <select
                            className="chroma-sort-select"
                            value={sortBy}
                            onChange={(e) => handleSortChange(e.target.value)}
                        >
                            <option value="count-desc">chunk 많은 순</option>
                            <option value="count-asc">chunk 적은 순</option>
                            <option value="name-asc">이름 오름차순</option>
                            <option value="name-desc">이름 내림차순</option>
                        </select>
                        <span className="chroma-refresh-meta">
                            마지막 갱신: {formatTimestamp(chromaStatus?.timestamp)}
                        </span>
                    </div>

                    <div className="table-container">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>상태</th>
                                    <th>컬렉션명</th>
                                    <th>저장 chunk 수</th>
                                    <th>비고</th>
                                </tr>
                            </thead>
                            <tbody>
                                {totalItems > 0 ? (
                                    currentItems.map((col) => {
                                        const state = getCollectionState(col?.count);
                                        const parsedCount = parseCount(col?.count);
                                        return (
                                        <tr key={col.name}>
                                            <td>
                                                <span className={`badge chroma-state-badge chroma-state-${state}`}>
                                                    {getCollectionStateLabel(state)}
                                                </span>
                                            </td>
                                            <td>{col.name}</td>
                                            <td>
                                                {parsedCount !== null
                                                    ? parsedCount.toLocaleString('ko-KR')
                                                    : '조회 실패'}
                                            </td>
                                            <td className="chroma-note-cell">
                                                {state === 'empty'
                                                    ? '미사용 또는 적재 대기'
                                                    : state === 'error'
                                                        ? '카운트 재조회 필요'
                                                        : '-'}
                                            </td>
                                        </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={4}>
                                            {collections.length > 0
                                                ? '검색 결과가 없습니다.'
                                                : '아직 저장된 컬렉션이 없습니다.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {totalItems > itemsPerPage && (
                        <div className="pagination">
                            <button
                                className="pagination-btn"
                                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                                disabled={safeCurrentPage === 1}
                            >
                                ❮ 이전
                            </button>

                            <div className="pagination-numbers">
                                {Array.from({ length: totalPages }, (_, i) => {
                                    const pageNum = i + 1;
                                    const isVisible =
                                        pageNum === 1 ||
                                        pageNum === totalPages ||
                                        (pageNum >= safeCurrentPage - 1 && pageNum <= safeCurrentPage + 1);

                                    if (!isVisible && i !== 0 && i !== totalPages - 1) {
                                        if (i === 1 || i === totalPages - 2) {
                                            return <span key={`dots-${i}`} className="pagination-dots">...</span>;
                                        }
                                        return null;
                                    }

                                    return (
                                        <button
                                            key={pageNum}
                                            className={`pagination-number ${safeCurrentPage === pageNum ? 'active' : ''}`}
                                            onClick={() => setCurrentPage(pageNum)}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                }).filter(Boolean)}
                            </div>

                            <button
                                className="pagination-btn"
                                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                                disabled={safeCurrentPage === totalPages}
                            >
                                다음 ❯
                            </button>
                        </div>
                    )}

                    {totalItems > 0 && (
                        <div className="pagination-info">
                            <span>
                                {safeCurrentPage} / {totalPages} 페이지
                            </span>
                            <span>
                                ({totalItems}개 항목 중 {indexOfFirstItem + 1}~{Math.min(indexOfLastItem, totalItems)}개 표시)
                            </span>
                        </div>
                    )}
                </>
            )}
        </section>
    );
};

export default ChromaStatus;
