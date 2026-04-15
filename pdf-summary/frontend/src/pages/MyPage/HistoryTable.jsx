// [2026-03-25 osj] 일괄삭제 체크박스 추가 - selectedIds, onSelectItem, onSelectAll props 추가
import React from "react";

const HistoryTable = ({
  items,
  isAdmin,
  selectedIds = [], // [2026-03-25 osj]
  onSelectItem, // [2026-03-25 osj]
  onSelectAll, // [2026-03-25 osj]
  onViewDocument,
  onEditSummary,
  onTogglePublic,
  onDeleteDocument,
}) => {
  // [2026-03-25 osj] 현재 페이지 전체선택 여부 판단
  const currentIds = items.map((i) => i.id);
  const allSelected =
    currentIds.length > 0 && currentIds.every((id) => selectedIds.includes(id));

  return (
    <div className="history-table-wrapper">
      <table className="history-table">
        <thead>
          <tr>
            {/* [2026-03-25 osj] 전체선택 체크박스 */}
            <th className="checkbox-col">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectAll(currentIds)}
                title="전체 선택"
              />
            </th>
            <th>날짜</th>
            <th>파일명</th>
            {isAdmin && <th>작성자</th>}
            <th>모델</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? (
            items.map((item) => (
              // [2026-03-25 osj] 선택된 행 하이라이트
              <tr
                key={item.id}
                className={selectedIds.includes(item.id) ? "row-selected" : ""}
              >
                {/* [2026-03-25 osj] 개별 체크박스 */}
                <td className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => onSelectItem(item.id)}
                  />
                </td>
                <td>{item.date}</td>
                <td className="file-name-cell" title={item.fileName}>
                  <span className="filename-text">{item.fileName}</span>
                  {item.is_important && (
                    <span title="중요 문서(비밀번호 설정)">🔒</span>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <div
                      style={{
                        fontSize: "12px",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ fontWeight: "bold" }}>
                        {item.user?.full_name || "알수없음"}
                      </div>
                      <div style={{ color: "#666" }}>
                        @{item.user?.username || "-"}
                      </div>
                    </div>
                  </td>
                )}
                <td>
                  <span className="model-tag">{item.model}</span>
                </td>
                <td>
                  <span className="status-badge">{item.status}</span>
                </td>
                <td>
                  <button
                    className="action-btn view"
                    onClick={() => onViewDocument(item)}
                  >
                    보기
                  </button>
                  <button
                    className="action-btn edit"
                    onClick={() => onEditSummary(item.id)}
                  >
                    편집
                  </button>
                  <button
                    className={`action-btn ${
                      item.is_public ? "public" : "private"
                    }`}
                    onClick={() => onTogglePublic(item)}
                  >
                    {item.is_public ? "🌐 공개" : "🔒 비공개"}
                  </button>
                  <button
                    className="action-btn delete"
                    onClick={() => onDeleteDocument(item.id, item.fileName)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={isAdmin ? 7 : 6}
                style={{ textAlign: "center", padding: "20px" }}
              >
                히스토리가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default HistoryTable;