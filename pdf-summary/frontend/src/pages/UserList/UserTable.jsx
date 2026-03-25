import React from "react";

const UserTable = ({
  currentItems,
  loading,
  itemsPerPage,
  filters,
  sortConfig,
  requestSort,
  canCheck,
  canView,
  handleCheckboxChange,
  handleViewClick,
  selectedItems,
  isMyDocument,
}) => {
  const highlightText = (text, query) => {
    if (!query || !text) return text || "";
    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    return text.toString().replace(regex, '<span class="highlight">$1</span>');
  };

  const columns = [
    {
      key: null,
      label: "선택",
      sortable: false,
      width: "60px",
      render: (item) => (
        <input
          type="checkbox"
          checked={selectedItems.includes(Number(item.id))}
          onChange={() => handleCheckboxChange(item.id)}
          disabled={!canCheck(item)}
        />
      ),
    },
    { key: "id", label: "문서번호", sortable: true, width: "90px" },
    {
      key: "datetime",
      label: "날짜 / 시간",
      sortable: true,
      highlight: true,
      width: "140px",
    },
    { key: "username", label: "ID", sortable: true, highlight: true },
    {
      key: "fullName",
      label: "사용자",
      sortable: true,
      highlight: true,
      className: "user-cell",
      extraProps: { "data-username": (item) => item.username },
    },
    { key: "filename", label: "파일명", sortable: true, highlight: true },
    { key: "model", label: "AI 모델", sortable: true, highlight: true },
    {
      key: "charCount",
      label: "원문자수",
      sortable: true,
      render: (item) => (
        <span>
          {Number(
            String(item.charCount || "0").replace(/[^0-9]/g, ""),
          ).toLocaleString("ko-KR")}
        </span>
      ),
    },
    { key: "category", label: "분류", sortable: true, highlight: true },
    {
      key: "isPublic",
      label: "공개여부",
      sortable: true,
      render: (item) =>
        item.isPublic ? (
          <span className="status-badge public">공개</span>
        ) : (
          <span className="status-badge private">비공개</span>
        ),
    },
    {
      key: "isImportant",
      label: "중요",
      sortable: true,
      render: (item) =>
        item.isImportant ? (
          <span className="status-badge important">중요</span>
        ) : (
          "-"
        ),
    },
    {
      key: null,
      label: "상태",
      sortable: false,
      render: () => <span className="status-badge completed">완료</span>,
    },
    {
      key: null,
      label: "보기",
      sortable: false,
      render: (item) => (
        <button
          className="view-btn"
          onClick={() => handleViewClick(item.id)}
          disabled={!canView(item)}
        >
          보기
        </button>
      ),
    },
  ];

  return (
    <div className="table-wrapper">
      <table className="summary-table">
        <thead>
          <tr>
            {columns.map((col, index) => (
              <th
                key={index}
                className={col.sortable ? "sortable" : ""}
                onClick={col.sortable ? () => requestSort(col.key) : undefined}
                style={col.width ? { width: col.width } : {}}
              >
                {col.label}
                {col.sortable && (
                  <span className="sort-icon">
                    {sortConfig.key === col.key
                      ? sortConfig.direction === "asc"
                        ? " ▲"
                        : " ▼"
                      : " ⇅"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: itemsPerPage }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="skeleton-row">
                {columns.map((_, colIdx) => (
                  <td key={colIdx}>
                    <div className="skeleton-bar" />
                  </td>
                ))}
              </tr>
            ))
          ) : currentItems.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  textAlign: "center",
                  padding: "60px 20px",
                  color: "#6b7280",
                }}
              >
                결과가 없습니다.
              </td>
            </tr>
          ) : (
            currentItems.map((item) => (
              <tr key={item.id} className={isMyDocument(item) ? "my-item" : ""}>
                {columns.map((col, colIndex) => (
                  <td
                    key={colIndex}
                    className={col.className || ""}
                    {...(col.extraProps
                      ? {
                          [Object.keys(col.extraProps)[0]]:
                            col.extraProps[Object.keys(col.extraProps)[0]](
                              item,
                            ),
                        }
                      : {})}
                  >
                    {col.render ? (
                      col.render(item)
                    ) : col.highlight ? (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: highlightText(
                            String(item[col.key] || ""),
                            filters.searchTerm,
                          ),
                        }}
                      />
                    ) : (
                      (item[col.key] ?? "-")
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

<<<<<<< HEAD
export default UserTable;
=======
export default UserTable;
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
