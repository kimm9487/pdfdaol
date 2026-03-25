import React from "react";

const PaginationArea = ({
  currentPage,
  totalPages,
  setCurrentPage,
  itemsPerPage,
  setItemsPerPage,
  filteredData,
}) => {
  return (
    <div className="list-bottom-bar">
      <div className="pagination-left">
        <div className="my-summary-indicator">
          <span className="blue-bar"></span>
          <span className="my-summary-text">= 내가 요약한 항목</span>
        </div>
      </div>
      <div className="pagination">
        <button
          className="page-arrow first"
          onClick={() => setCurrentPage(1)}
          disabled={currentPage === 1}
        >
          «
        </button>
        <button
          className="page-arrow prev"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage === 1}
        >
          ‹
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            className={`page-number ${currentPage === page ? "active" : ""}`}
            onClick={() => setCurrentPage(page)}
          >
            {page}
          </button>
        ))}
        <button
          className="page-arrow next"
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
        >
          ›
        </button>
        <button
          className="page-arrow last"
          onClick={() => setCurrentPage(totalPages)}
          disabled={currentPage === totalPages}
        >
          »
        </button>
      </div>
      <div className="items-per-page">
        페이지당
        <select
          value={itemsPerPage}
          onChange={(e) => {
            const newPerPage = Number(e.target.value);
            setItemsPerPage(newPerPage);
            setCurrentPage((prev) =>
              Math.min(prev, Math.ceil(filteredData.length / newPerPage) || 1),
            );
          }}
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        건 표시 | 총 <strong>{filteredData.length.toLocaleString()}</strong>건
      </div>
    </div>
  );
};

<<<<<<< HEAD
export default PaginationArea;
=======
export default PaginationArea;
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
