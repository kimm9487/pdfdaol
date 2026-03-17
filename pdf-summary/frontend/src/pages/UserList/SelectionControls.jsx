import React from "react";

const SelectionControls = ({
  selectedItems,
  toggleCurrentPage,
  toggleAllFiltered,
  clearAllSelection,
  handleDownload,
  filteredData,
}) => {
  return (
    <div className="selection-controls">
      <span className="selected-count">{selectedItems.length}개 선택됨</span>
      <button className="select-btn" onClick={toggleCurrentPage}>
        이 페이지 전체 선택/해제
      </button>
      <button className="select-btn" onClick={toggleAllFiltered}>
        현재 필터 전체 선택/해제 ({filteredData.length}건)
      </button>
      <button className="select-btn danger" onClick={clearAllSelection}>
        선택 해제
      </button>
      <button
        className={`download-btn ${selectedItems.length === 0 ? "empty-selection" : ""}`}
        onClick={handleDownload}
      >
        {selectedItems.length > 0
          ? `선택 항목 다운로드 (${selectedItems.length}개)`
          : "선택 항목 다운로드"}
      </button>
    </div>
  );
};

export default SelectionControls;