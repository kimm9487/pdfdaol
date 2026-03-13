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
          const isVisible =
            pageNum === 1 ||
            pageNum === totalPages ||
            (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

          const isEllipsis =
            !isVisible && (i === 1 || i === totalPages - 2);

          if (!isVisible && i !== 0 && i !== 1) {
            // Render ellipsis only once
            if (
              !document.querySelector(
                `.pagination-dots[data-key="dots-${i > currentPage ? "end" : "start"}"]`,
              )
            ) {
              return (
                <span
                  key={`dots-${i > currentPage ? "end" : "start"}`}
                  data-key={`dots-${i > currentPage ? "end" : "start"}`}
                  className="pagination-dots"
                >
                  ...
                </span>
              );
            }
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
