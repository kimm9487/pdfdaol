import React from "react";

const FilterSection = ({
  filters,
  setFilters,
  setCurrentPage,
  handlePresetClick,
  toggleDateRange,
  availableModels,
}) => {
  return (
    <>
      <div className="preset-filters">
        <button
          className={`preset-btn ${filters.activePreset === "all" ? "active" : ""}`}
          onClick={() => handlePresetClick("all")}
        >
          전체
        </button>
        <button
          className={`preset-btn ${filters.activePreset === "myDocs" ? "active" : ""}`}
          onClick={() => handlePresetClick("myDocs")}
        >
          내 문서만
        </button>
        <button
          className={`preset-btn ${filters.activePreset === "important" ? "active" : ""}`}
          onClick={() => handlePresetClick("important")}
        >
          중요 문서
        </button>
        <button
          className={`preset-btn ${filters.activePreset === "today" ? "active" : ""}`}
          onClick={() => handlePresetClick("today")}
        >
          오늘
        </button>
        <button
          className={`preset-btn ${filters.activePreset === "last7days" ? "active" : ""}`}
          onClick={() => handlePresetClick("last7days")}
        >
          최근 7일
        </button>
        <button
          className={`preset-btn ${filters.dateFilter.type === "range" ? "active" : ""}`}
          onClick={toggleDateRange}
        >
          기간 선택 {filters.dateFilter.type === "range" ? "▲" : "▼"}
        </button>

        {filters.dateFilter.type === "range" && (
          <div className="date-range-picker">
            <div className="date-field start">
              <label className="date-label">시작일</label>
              <div className="date-input-wrapper">
                <input
                  type="date"
                  className="date-input"
                  value={filters.dateFilter.range.start}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      dateFilter: {
                        ...prev.dateFilter,
                        range: {
                          ...prev.dateFilter.range,
                          start: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
            </div>
            <span className="date-separator">~</span>
            <div className="date-field end">
              <label className="date-label">종료일</label>
              <div className="date-input-wrapper">
                <input
                  type="date"
                  className="date-input"
                  value={filters.dateFilter.range.end}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      dateFilter: {
                        ...prev.dateFilter,
                        range: {
                          ...prev.dateFilter.range,
                          end: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="filter-container">
        <div className="filter-bar">
          <div className="search-group">
            <input
              type="text"
              placeholder="파일명, 사용자, 날짜 등 검색..."
              value={filters.searchTerm}
              onChange={(e) => {
                setFilters((prev) => ({ ...prev, searchTerm: e.target.value }));
                setCurrentPage(1);
              }}
            />
            <span className="search-icon">🔍</span>
          </div>
          <select
            value={filters.categoryFilter}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                categoryFilter: e.target.value,
              }))
            }
          >
            <option value="전체">분류: 전체</option>
<<<<<<< HEAD
            <option value="법령·규정">법령·규정</option>
            <option value="행정·공문">행정·공문</option>
            <option value="보고·계획">보고·계획</option>
            <option value="재정·계약">재정·계약</option>
=======
            <option value="강의">강의</option>
            <option value="법률안">법률안</option>
            <option value="보고서">보고서</option>
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
            <option value="기타">기타</option>
          </select>
          <select
            value={filters.modelFilter}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, modelFilter: e.target.value }))
            }
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={filters.publicFilter}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, publicFilter: e.target.value }))
            }
          >
            <option value="all">전체 (내 비공개 포함)</option>
            <option value="public">공개된 문서</option>
            <option value="private">내 비공개 문서</option>
          </select>
        </div>
      </div>
    </>
  );
};

<<<<<<< HEAD
export default FilterSection;
=======
export default FilterSection;
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
