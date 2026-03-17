import React from "react";

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="pagination">
      <button
        className="pagination-btn"
        onClick={() => onPageChange((prev) => Math.max(prev - 1, 1))}
        disabled={currentPage === 1}
      >
        ❮ 이전
      </button>
      <div className="pagination-numbers">
        {Array.from({ length: totalPages }, (_, i) => {
          const pageNum = i + 1;
          // 첫 페이지, 마지막 페이지, 그리고 현재 페이지 기준 앞뒤 1페이지씩만 보이도록 설정
          const isVisible =
            pageNum === 1 ||
            pageNum === totalPages ||
            (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

          if (!isVisible) {
            // 첫 번째 줄임표(...)는 2번 페이지 위치에 한 번만 렌더링
            if (pageNum === 2) {
              return (
                <span key="dots-start" className="pagination-dots">
                  ...
                </span>
              );
            }
            // 두 번째 줄임표(...)는 마지막에서 두 번째 페이지 위치에 한 번만 렌더링
            if (pageNum === totalPages - 1) {
              return (
                <span key="dots-end" className="pagination-dots">
                  ...
                </span>
              );
            }
            // 나머지 숨겨지는 페이지 번호들은 아무것도 그리지 않음
            return null;
          }

          return (
            <button
              key={pageNum}
              className={`pagination-number ${
                currentPage === pageNum ? "active" : ""
              }`}
              onClick={() => onPageChange(pageNum)}
            >
              {pageNum}
            </button>
          );
        }).filter(Boolean)}
      </div>
      <button
        className="pagination-btn"
        onClick={() => onPageChange((prev) => Math.min(prev + 1, totalPages))}
        disabled={currentPage === totalPages}
      >
        다음 ❯
      </button>
    </div>
  );
};

export default Pagination;