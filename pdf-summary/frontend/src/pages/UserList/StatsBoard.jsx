import React from "react";

const StatsBoard = ({ filteredData, isMyDocument }) => {
  return (
    <div className="quick-stats">
      <div className="stat-item total">
        <div className="stat-icon">📄</div>
        <div className="stat-value">{filteredData.length.toLocaleString()}</div>
        <div className="stat-label">전체 문서</div>
      </div>
      <div className="stat-item today">
        <div className="stat-icon">📅</div>
        <div className="stat-value">
          {filteredData
            .filter((d) =>
              d.created_at?.startsWith(new Date().toISOString().split("T")[0]),
            )
            .length.toLocaleString()}
        </div>
        <div className="stat-label">오늘 업로드</div>
      </div>
      <div className="stat-item important">
        <div className="stat-icon">🔒</div>
        <div className="stat-value">
          {filteredData.filter((d) => d.isImportant).length.toLocaleString()}
        </div>
        <div className="stat-label">중요 문서</div>
      </div>
      <div className="stat-item mydocs">
        <div className="stat-icon">👤</div>
        <div className="stat-value">
          {filteredData.filter(isMyDocument).length.toLocaleString()}
        </div>
        <div className="stat-label">내 문서</div>
      </div>
    </div>
  );
};

<<<<<<< HEAD
export default StatsBoard;
=======
export default StatsBoard;
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
