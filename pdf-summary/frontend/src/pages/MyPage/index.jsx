import React, { useState, useEffect } from "react";
import { useSessionValidator } from "../../hooks/useSessionValidator";
import { useLogout } from "../../hooks/useLogout";
import { useDocumentHistory } from "../../hooks/useDocumentHistory";
import "./style.css";

import UserProfileCard from "./UserProfileCard";
import HistoryTable from "./HistoryTable";
import Pagination from "./Pagination";
import EditProfileModal from "./EditProfileModal";
import DocumentDetailModal from "./DocumentDetailModal";
import EditSummaryModal from "./EditSummaryModal";

const MyPage = () => {
  useSessionValidator();
  const handleLogout = useLogout(null, { showAlert: false });

  const {
    userInfo,
    history,
    loading,
    handleProfileUpdate,
    fetchDocument,
    saveSummary,
    deleteDocument,
    deleteBulk, // [2026-03-25 osj] 일괄삭제 함수
    togglePublic,
    deleteAccount,
  } = useDocumentHistory();

  // ===== 모달 상태 =====
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [showSummaryEditModal, setShowSummaryEditModal] = useState(false);
  const [documentToEdit, setDocumentToEdit] = useState(null);

  // ===== 페이지네이션 상태 =====
  // [2026-03-25 osj] 일괄삭제 선택 상태
  const [selectedIds, setSelectedIds] = useState([]);

  // [2026-03-25 osj] 개별 체크박스 토글
  const handleSelectItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // [2026-03-25 osj] 현재 페이지 전체 선택/해제
  const handleSelectAll = (ids) => {
    setSelectedIds((prev) =>
      ids.every((id) => prev.includes(id))
        ? prev.filter((x) => !ids.includes(x))
        : [...new Set([...prev, ...ids])],
    );
  };

  // [2026-03-25 osj] 선택된 문서 일괄 삭제
  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (
      !window.confirm(`선택한 ${selectedIds.length}개 문서를 삭제하시겠습니까?`)
    )
      return;
    await deleteBulk(selectedIds);
    setSelectedIds([]);
  };

  // ===== 페이지네이션 상태 =====
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const totalPages = Math.ceil(history.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = history.slice(indexOfFirstItem, indexOfLastItem);

  useEffect(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");

    if (!userDbId || !sessionToken) {
      console.log("로그인 정보 없음, 로그아웃 처리");
      handleLogout();
    }
  }, [handleLogout]);

  useEffect(() => {
    setCurrentPage(1);
  }, [history]);

  // 문서 관련 핸들러들
  const handleViewDocument = async (doc) => {
    const fullDoc = await fetchDocument(doc.id);
    if (fullDoc) {
      setSelectedDocument(fullDoc);
      setShowDetailModal(true);
    }
  };

  const handleEditSummary = async (docId) => {
    const doc = await fetchDocument(docId);
    if (doc) {
      setDocumentToEdit(doc);
      setShowSummaryEditModal(true);
    }
  };

  const handleSaveSummary = async (updatedData) => {
    const success = await saveSummary(updatedData);
    if (success) {
      setShowSummaryEditModal(false);
      setDocumentToEdit(null);
    }
  };

  if (loading) {
    return (
      <div className="mypage-container">
        <p>로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="mypage-container">
      <div className="mypage-content">
        <UserProfileCard
          userInfo={userInfo}
          historyLength={history.length}
          onEditClick={() => setShowEditModal(true)}
          onDeleteAccount={deleteAccount}
        />

        <main className="history-section">
          {/* [2026-03-25 osj] 일괄삭제 버튼 포함 헤더 */}
          <div className="history-header">
            <h3 className="section-title">
              최근 요약 히스토리 {userInfo.role === "admin" && " (전체)"}
            </h3>
            {selectedIds.length > 0 && (
              <button className="bulk-delete-btn" onClick={handleBulkDelete}>
                선택 삭제 ({selectedIds.length})
              </button>
            )}
          </div>
          <HistoryTable
            items={currentItems}
            isAdmin={userInfo.role === "admin"}
            selectedIds={selectedIds}
            onSelectItem={handleSelectItem}
            onSelectAll={handleSelectAll}
            onViewDocument={handleViewDocument}
            onEditSummary={handleEditSummary}
            onTogglePublic={togglePublic}
            onDeleteDocument={deleteDocument}
          />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </main>
      </div>

      <EditProfileModal
        show={showEditModal}
        onClose={() => setShowEditModal(false)}
        userInfo={userInfo}
        onProfileUpdate={handleProfileUpdate}
      />

      <DocumentDetailModal
        show={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        document={selectedDocument}
      />

      <EditSummaryModal
        show={showSummaryEditModal}
        onClose={() => {
          setShowSummaryEditModal(false);
          setDocumentToEdit(null);
        }}
        document={documentToEdit}
        onSave={handleSaveSummary}
      />
    </div>
  );
};

export default MyPage;