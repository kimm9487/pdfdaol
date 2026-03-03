// src/pages/UserList.jsx
import React, { useState, useEffect } from "react";
import "./UserList.css";

const UserList = () => {
  const currentUser =
    localStorage.getItem("userName") || "정재훈";
  const isAdmin =
    localStorage.getItem("userRole") === "admin";   // ← 관리자 계정 권한

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("최신순");
  const [modelFilter, setModelFilter] = useState("전체 모델");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);

  // [정재훈] 2026-03-02 추가: 체크박스 선택 상태 관리 (문서 ID 배열)
  const [selectedItems, setSelectedItems] = useState([]);

  // [재훈] 2026-03-01 추가: 보기 버튼 클릭 시 해당 문서의 summary만 모달에 표시
  const [selectedSummary, setSelectedSummary] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // [정재훈] 2026-03-02 추가: 정렬 상태 관리 (컬럼명 + 방향)
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          "http://localhost:8000/api/admin/documents",
        );
        if (!response.ok) throw new Error("데이터 불러오기 실패");

        const result = await response.json();

        const mappedData = result.documents.map((doc, index) => {
          const createdDate = doc.created_at ?
            new Date(doc.created_at) : null;

          return {
            id: doc.id || index + 1,
            userId: doc.user?.id || "N/A", // 내부용 (툴팁에만 사용)
            username: doc.user?.username || "알수없음", // 로그인 ID
            fullName: doc.user?.full_name || doc.user?.username || "알수없음", // 표시용 이름
            datetime: createdDate
              ? createdDate
                .toLocaleString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })
                .replace(/\. /g, "-")
                .replace(" ", "\n")
              : "날짜 없음",
            filename: doc.filename || "파일명 없음",
            model: doc.model_used || "gemma3:latest",
            charCount: doc.char_count ? doc.char_count.toLocaleString() : "0",
            status: "완료",
            summary: doc.summary || "요약 내용이 없습니다.",
            sortDate: createdDate,
          };
        });

        setData(mappedData);
      } catch (err) {
        setError(err.message);
        console.error("데이터 로드 오류:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // [정재훈] 2026-03-02 추가: 체크박스 토글 함수 (현재 사용자 문서만 선택 가능)
  const handleCheckboxChange = (docId, username, fullName) => {
    if (username !== currentUser && fullName !== currentUser) return;

    const numericId = Number(docId);

    // NaN이거나 유효하지 않으면 무시
    if (isNaN(numericId) || numericId <= 0) {
      console.warn("[정재훈] 유효하지 않은 docId:", docId);
      return;
    }

    setSelectedItems((prev) =>
      prev.includes(numericId)
        ? prev.filter((id) => id !== numericId)
        : [...prev, numericId],
    );
  };

  // [정재훈] 2026-03-02 최종 수정: Body에 user_id도 함께 보내기 (401 에러 완전 해결)
  const handleDownload = async () => {
    if (selectedItems.length === 0) {
      alert("다운로드할 항목을 선택하세요.");
      return;
    }

    const safeSelectedIds = selectedItems
      .map((id) => Number(id))
      .filter((id) => !isNaN(id) && id > 0);

    try {
      // 여기서부터 실제 fetch + blob 다운로드 코드가 빠져 있거나 주석처리된 상태로 보임
      // ↓↓↓ 이 부분이 없으면 버튼 눌러도 아무 일도 안 일어남 ↓↓↓

      let sendUserId = currentUser;

      const usernameRes = await fetch(
        "http://localhost:8000/api/admin/current-username",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `user_id=${encodeURIComponent(currentUser)}`,
        },
      );

      if (usernameRes.ok) {
        const data = await usernameRes.json();
        sendUserId = data.username;
        console.log("[정재훈] 서버에서 조회한 실제 username:", sendUserId);
      }

      const response = await fetch(
        "http://localhost:8000/api/admin/download-selected",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selected_ids: safeSelectedIds,
            user_id: sendUserId,
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`다운로드 실패: ${response.status} - ${errText}`);
      }

      // ★★★★★ 여기부터 blob → 파일 다운로드 로직이 핵심 ★★★★★
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sendUserId}_선택_요약목록.csv`; // 파일명
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("다운로드 오류:", err);
      alert("다운로드 중 오류가 발생했습니다.\n" + err.message);
    }
  };

  const handleViewClick = (docId) => {
    const doc = data.find((item) => item.id === docId);
    if (!doc) {
      alert("해당 문서를 찾을 수 없습니다.");
      return;
    }

    if (doc.username !== currentUser && doc.fullName !== currentUser) {
      alert("이 문서는 당신이 작성한 것이 아닙니다.");
      return;
    }

    setSelectedSummary(doc.summary);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedSummary(null);
  };

  // [정재훈] 2026-03-02 추가: 컬럼 클릭 시 정렬 토글
  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
    setCurrentPage(1); // 정렬 시 페이지 초기화
  };

  if (loading)
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        데이터 로딩 중...
      </div>
    );
  if (error)
    return <div style={{ padding: "40px", color: "red" }}>오류: {error}</div>;

  let filteredData = data.filter(
    (item) =>
      item.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.charCount.includes(searchTerm) ||
      item.datetime.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  if (modelFilter !== "전체 모델") {
    filteredData = filteredData.filter((item) => item.model === modelFilter);
  }

  if (sortOption === "최신순") {
    filteredData.sort(
      (a, b) => (b.sortDate || new Date(0)) - (a.sortDate || new Date(0)),
    );
  } else if (sortOption === "오래된순") {
    filteredData.sort(
      (a, b) => (a.sortDate || new Date(0)) - (b.sortDate || new Date(0)),
    );
  }

  // [정재훈] 2026-03-02 추가: sortConfig에 따라 데이터 정렬
  if (sortConfig.key) {
    filteredData.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      // 날짜/시간은 Date 객체로 비교
      if (sortConfig.key === "datetime") {
        const dateA = new Date(a.sortDate || a.datetime);
        const dateB = new Date(b.sortDate || b.datetime);
        return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
      }

      // 숫자형 (원문자수 등)
      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortConfig.direction === "asc"
          ? aValue - bValue
          : bValue - aValue;
      }

      // 문자열 기본 비교
      const strA = String(aValue || "").toLowerCase();
      const strB = String(bValue || "").toLowerCase();
      return sortConfig.direction === "asc"
        ? strA.localeCompare(strB)
        : strB.localeCompare(strA);
    });
  }

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const indexOfLast = currentPage * itemsPerPage;
  const indexOfFirst = indexOfLast - itemsPerPage;
  const currentItems = filteredData.slice(indexOfFirst, indexOfLast);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const highlightText = (text, query) => {
    if (!query || !text) return text || "";

    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    return text.toString().replace(regex, '<span class="highlight">$1</span>');
  };

  return (
    <div className="summary-list-page">
      <div className="title-wrapper">
        <div className="title-bar"></div>
        <h2>04. 요약 목록 보기</h2>
      </div>

      <div className="description-wrapper">
        <div className="description-box">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flex: 1,
              }}
            >
              <span className="blue-icon">📝</span>
              <p style={{ margin: 0 }}>
                전체 사용자의 요약 이력을 조회할 수 있습니다. (본인 포함 전체
                공개)
              </p>
            </div>

            <button className="download-btn" onClick={handleDownload}>
              <span className="download-icon">⬇</span> 목록 다운로드
            </button>
          </div>
        </div>
      </div>

      <div className="filter-container">
        <div className="filter-bar">
          <div className="search-group">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="파일명, 사용자, 모델 등 검색..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <select
            value={sortOption}
            onChange={(e) => {
              setSortOption(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option>최신순</option>
            <option>오래된순</option>
          </select>
          <select
            value={modelFilter}
            onChange={(e) => {
              setModelFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option>전체 모델</option>
            <option>gemma3:latest</option>
            <option>gemma2:latest</option>
            <option>gemma3:1b</option>
          </select>
          <button className="search-btn">검색</button>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="summary-table">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>선택</th>
              <th>#</th>

              {/* [정재훈] 2026-03-02 추가: 정렬 버튼 */}
              <th className="sortable" onClick={() => requestSort("datetime")}>
                날짜 / 시간
                <span
                  className={`sort-icon ${sortConfig.key === "datetime" ? sortConfig.direction : "none"}`}
                >
                  {sortConfig.key === "datetime"
                    ? sortConfig.direction === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅"}
                </span>
              </th>

              <th className="sortable" onClick={() => requestSort("username")}>
                ID
                <span
                  className={`sort-icon ${sortConfig.key === "username" ? sortConfig.direction : "none"}`}
                >
                  {sortConfig.key === "username"
                    ? sortConfig.direction === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅"}
                </span>
              </th>

              <th className="sortable" onClick={() => requestSort("fullName")}>
                사용자
                <span
                  className={`sort-icon ${sortConfig.key === "fullName" ? sortConfig.direction : "none"}`}
                >
                  {sortConfig.key === "fullName"
                    ? sortConfig.direction === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅"}
                </span>
              </th>

              <th className="sortable" onClick={() => requestSort("filename")}>
                파일명
                <span
                  className={`sort-icon ${sortConfig.key === "filename" ? sortConfig.direction : "none"}`}
                >
                  {sortConfig.key === "filename"
                    ? sortConfig.direction === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅"}
                </span>
              </th>

              <th className="sortable" onClick={() => requestSort("model")}>
                AI 모델
                <span
                  className={`sort-icon ${sortConfig.key === "model" ? sortConfig.direction : "none"}`}
                >
                  {sortConfig.key === "model"
                    ? sortConfig.direction === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅"}
                </span>
              </th>

              <th className="sortable" onClick={() => requestSort("charCount")}>
                원문자수
                <span
                  className={`sort-icon ${sortConfig.key === "charCount" ? sortConfig.direction : "none"}`}
                >
                  {sortConfig.key === "charCount"
                    ? sortConfig.direction === "asc"
                      ? " ▲"
                      : " ▼"
                    : " ⇅"}
                </span>
              </th>

              <th>상태</th>
              <th>보기</th>
            </tr>
          </thead>
          <tbody>
            {currentItems.map((item, index) => (
              <tr
                key={item.id}
                className={
                  item.username === currentUser || item.fullName === currentUser
                    ? "my-item"
                    : ""
                }
              >
                <td>
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(Number(item.id))}
                    onChange={() =>
                      handleCheckboxChange(item.id, item.username, item.fullName,)
                    }
                    disabled={
                      item.username !== currentUser &&
                      item.fullName !== currentUser
                    }
                  />
                </td>
                {/* 여기만 수정됨 → # 컬럼에 실제 문서 ID 표시 */}
                <td>{item.id}</td>
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.datetime, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.username, searchTerm),
                  }}
                />
                <td
                  className="user-cell"
                  data-username={item.username}
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.fullName, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.filename, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.model, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.charCount, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.status, searchTerm),
                  }}
                />
                <td>
                  <button
                    className="view-btn"
                    onClick={() => handleViewClick(item.id)}
                  >
                    보기
                  </button>
                </td>
              </tr>
            ))}

            {/* [정재훈] 2026-03-02 수정: hydration 에러 방지 - 빈 행 안전하게 생성 */}
            {Array.from({ length: itemsPerPage - currentItems.length }).map(
              (_, i) => (
                <tr key={`empty-row-${i}`} className="empty-row">
                  <td colSpan={10}>&nbsp;</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && selectedSummary && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>
              ×
            </button>
            <h2>내 요약 내용</h2>
            <div className="modal-section">
              <pre className="modal-text">{selectedSummary}</pre>
            </div>
          </div>
        </div>
      )}

      <div className="list-bottom-bar">
        <div className="pagination-left">
          <div className="my-summary-indicator">
            <span className="blue-bar"></span>
            <span className="my-summary-text">= 내가 요약한 항목</span>
          </div>
        </div>

        <div className="pagination">
          <button
            className="page-arrow"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            &lt;
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              className={`page-number ${currentPage === page ? "active" : ""}`}
              onClick={() => goToPage(page)}
            >
              {page}
            </button>
          ))}

          <button
            className="page-arrow"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            &gt;
          </button>
        </div>

        <div className="items-per-page">
          페이지당
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          건 표시
        </div>
      </div>

      <div className="bottom-notes-grid">
        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">🔍</span> 검색 / 필터
          </div>
          <p>• 파일명 또는 사용자 이름 검색</p>
          <p>• 모델 및 정렬 기준 선택 가능</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">📋</span> 목록 보기
          </div>
          <p>• 전체 사용자의 요약 이력 조회</p>
          <p>• 기본 정렬 : 최신순</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon blue-dot">●</span> 내 항목 강조
          </div>
          <p>• 내가 작성한 요약은 파란 배경</p>
          <p>• 왼쪽에 파란색 바 표시</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">👁️</span> 상세 보기
          </div>
          <p>• 보기 버튼 클릭 시 요약 내용 확인</p>
          <p>• 원문 + 요약 결과 표시 예정</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">📄</span> 페이지네이션
          </div>
          <p>• 페이지당 5~100건 선택 가능</p>
          <p>• 총 건수 실시간 표시</p>
        </div>
      </div>
    </div>
  );
};

export default UserList;
