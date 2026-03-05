import React, { useState, useEffect } from "react";
import { useSessionValidator } from "../hooks/useSessionValidator";
import { useLogout } from "../hooks/useLogout";
import "./MyPage.css";

const MyPage = () => {
  // ===== [추가] 세션 유효성 검증 (10분 주기, 강제 로그아웃 대상은 즉시+5초) =====
  useSessionValidator(); // 기본값 10분, 강제 로그아웃 대상이면 즉시+5초 주기로 검증

  // ===== [추가] 로그인 정보 확인 =====
  const handleLogout = useLogout(null, { showAlert: false });

  useEffect(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");

    if (!userDbId || !sessionToken) {
      console.log("로그인 정보 없음, 로그아웃 처리");
      handleLogout();
    }
  }, []); // 마운트할 때 한 번만 실행

  // ===== [추가] 상태 관리 =====
  // 사용자 프로필 정보
  const [userInfo, setUserInfo] = useState({
    username: "",
    full_name: localStorage.getItem("userName") || "사용자",
    email: "이메일 정보 없음",
    role: "user", // 관리자('admin') 또는 일반('user')
  });

  // 히스토리 데이터
  const [history, setHistory] = useState([]);

  // 로딩 상태
  const [loading, setLoading] = useState(true);

  // ===== [추가] 프로필 수정 모달 상태 =====
  const [showEditModal, setShowEditModal] = useState(false);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // ===== [추가] 상세보기 모달 상태 =====
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);

  // ===== [추가] 편집 모달 상태 =====
  const [showSummaryEditModal, setShowSummaryEditModal] = useState(false);
  const [editingDocId, setEditingDocId] = useState(null);
  // ===== [수정] 파일명과 원문도 수정할 수 있도록 추가 =====
  const [editingFileName, setEditingFileName] = useState("");
  const [editingExtractedText, setEditingExtractedText] = useState("");
  const [editingSummary, setEditingSummary] = useState("");
  // ===== [추가] 중요 문서 및 비밀번호 상태 =====
  const [editingIsImportant, setEditingIsImportant] = useState(false);
  const [editingDocPassword, setEditingDocPassword] = useState("");

  // ===== [추가] 페이지네이션 상태 =====
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10; // 한 페이지에 10개씩 표시

  // ===== [추가] 페이지네이션 계산 =====
  const totalPages = Math.ceil(history.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = history.slice(indexOfFirstItem, indexOfLastItem);

  // ===== [추가] 사용자 정보 및 히스토리 로드 =====
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const userDbId = localStorage.getItem("userDbId");
        const userId = localStorage.getItem("userId");

        console.log("📌 MyPage 로드:", { userDbId, userId });

        if (!userDbId) {
          console.error("userDbId가 없습니다");
          setLoading(false);
          return;
        }

        // 프로필 정보 조회
        console.log(
          `📡 프로필 조회: http://localhost:8000/auth/profile/${userDbId}`,
        );
        const profileResponse = await fetch(
          `http://localhost:8000/auth/profile/${userDbId}`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

        console.log("📊 프로필 응답:", profileResponse.status);

        let userRole = "user";
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          console.log("✅ 프로필 데이터:", profileData);
          setUserInfo(profileData);
          setEditEmail(profileData.email);
          userRole = profileData.role;
        } else {
          console.warn("⚠️ 프로필 조회 실패:", profileResponse.status);
        }

        // ===== [수정] 관리자는 /api/admin/documents, 일반 유저는 /api/documents/{userDbId} 호출 =====
        let historyUrl;
        if (userRole === "admin") {
          // 관리자: 모든 문서 조회
          historyUrl = `http://localhost:8000/api/admin/documents?limit=1000`;
        } else {
          // 일반 유저: 본인 문서만 조회
          historyUrl = `http://localhost:8000/api/documents/${userDbId}?limit=1000`;
        }

        console.log(`📡 히스토리 조회: ${historyUrl}`);
        const historyResponse = await fetch(historyUrl, {
          cache: "no-store",
          credentials: "include",
        });

        console.log("📊 히스토리 응답:", historyResponse.status);

        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          console.log("✅ 히스토리 데이터:", historyData);
          if (historyData && Array.isArray(historyData.documents)) {
            // 문서 목록을 히스토리 형식으로 변환
            const formattedHistory = historyData.documents.map((doc) => ({
              id: doc.id,
              date: doc.created_at ? doc.created_at.split("T")[0] : "",
              fileName: doc.filename,
              model: doc.model_used || "N/A",
              status: "완료",
              summary: doc.summary,
              // ===== [추가] 편집/삭제 가능 여부 (관리자 또는 본인) =====
              canEdit: true, // 실제로는 뒤에서 권한 확인
              extracted_text: doc.extracted_text,
              // ===== [추가] 공개/비공개 및 중요 문서 정보 =====
              is_public:
                String(doc.is_public) === "true" ||
                String(doc.is_public) === "1",
              is_important:
                doc.is_important === true || String(doc.is_important) === "1",
              // ===== [추가] 작성자 정보 (관리자용) =====
              user: doc.user || null,
            }));
            setHistory(formattedHistory);
            console.log(`✅ ${formattedHistory.length}개 문서 로드됨`);
            // ===== [추가] 히스토리 로드 후 페이지를 1로 리셋 =====
            setCurrentPage(1);
          } else {
            console.error("⚠️ 응답 형식이 올바르지 않습니다:", historyData);
          }
        } else {
          console.error("❌ 히스토리 조회 실패:", historyResponse.status);
          const errorText = await historyResponse.text();
          console.error("❌ 에러 내용:", errorText);
        }

        setLoading(false);
      } catch (error) {
        console.error("❌ 데이터 로드 에러:", error);
        console.error("❌ 에러 상세:", error.message);
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  // ===== [추가] 프로필 수정 함수 =====
  const handleEditProfile = async () => {
    if (!currentPassword) {
      alert("현재 비밀번호를 입력해주세요.");
      return;
    }

    if (editPassword && editPassword.length < 6) {
      alert("새 비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setEditLoading(true);

    try {
      const userDbId = localStorage.getItem("userDbId");
      const formData = new FormData();

      if (editEmail && editEmail !== userInfo.email) {
        formData.append("email", editEmail);
      }

      if (editPassword) {
        formData.append("new_password", editPassword);
      }

      formData.append("current_password", currentPassword);

      const response = await fetch(
        `http://localhost:8000/auth/profile/${userDbId}`,
        {
          method: "PUT",
          body: formData,
        },
      );

      if (response.ok) {
        const data = await response.json();
        setUserInfo((prev) => ({
          ...prev,
          email: data.email,
        }));
        alert("프로필이 성공적으로 수정되었습니다.");
        setShowEditModal(false);
        setCurrentPassword("");
        setEditPassword("");
      } else {
        const error = await response.json();
        alert(error.detail || "프로필 수정 실패");
      }
    } catch (error) {
      console.error("프로필 수정 에러:", error);
      alert("프로필 수정 중 오류가 발생했습니다.");
    } finally {
      setEditLoading(false);
    }
  };

  // ===== [추가] 문서상세보기 함수 =====
  const handleViewDocument = async (doc) => {
    try {
      const userDbId = localStorage.getItem("userDbId");

      // ===== [수정] GET 요청이므로 쿼리 파라미터로 user_id 전달 =====
      const response = await fetch(
        `http://localhost:8000/api/document/${doc.id}?user_id=${userDbId}`,
        {
          method: "GET",
        },
      );

      if (response.ok) {
        const fullDoc = await response.json();
        setSelectedDocument(fullDoc);
        setShowDetailModal(true);
      } else {
        const error = await response.json();
        alert(error.detail || "문서를 불러올 수 없습니다.");
      }
    } catch (error) {
      console.error("문서 조회 에러:", error);
      alert("문서를 불러올 수 없습니다.");
    }
  };

  // ===== [수정] 문서 편집 함수 - DB에서 최신 데이터 조회 후 수정 =====
  const handleEditSummary = async (docId) => {
    try {
      const userDbId = localStorage.getItem("userDbId");

      // ===== [추가] DB에서 최신 전체 데이터 조회 =====
      const response = await fetch(
        `http://localhost:8000/api/document/${docId}?user_id=${userDbId}`,
        { method: "GET" },
      );

      if (response.ok) {
        const doc = await response.json();
        setEditingDocId(docId);
        setEditingFileName(doc.filename || "");
        setEditingExtractedText(doc.extracted_text || "");
        setEditingSummary(doc.summary || "");
        // ===== [추가] 중요 문서 여부 및 기존 비밀번호 로드 =====
        setEditingIsImportant(doc.is_important || false);
        setEditingDocPassword(doc.password || "");
        setShowSummaryEditModal(true);
      } else {
        alert("문서 정보를 불러올 수 없습니다.");
      }
    } catch (error) {
      console.error("문서 편집 로드 에러:", error);
      alert("문서 정보를 불러올 수 없습니다.");
    }
  };

  // ===== [수정] 문서 정보 저장 함수 - 파일명, 원문, 요약, 비밀번호 모두 저장 =====
  const handleSaveSummary = async () => {
    // 중요 문서일 경우 비밀번호 자릿수 체크
    if (
      editingIsImportant &&
      (editingDocPassword.length !== 4 || !/^\d+$/.test(editingDocPassword))
    ) {
      alert("중요 문서는 숫자 4자리 비밀번호가 필요합니다.");
      return;
    }

    try {
      const userDbId = localStorage.getItem("userDbId");

      const response = await fetch(
        `http://localhost:8000/api/summarize/${editingDocId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: parseInt(userDbId),
            // ===== [수정] 파일명, 원문, 요약, 비밀번호 정보 모두 전송 =====
            filename: editingFileName,
            extracted_text: editingExtractedText,
            summary: editingSummary,
            is_important: editingIsImportant,
            password: editingIsImportant ? editingDocPassword : null,
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        // 히스토리 업데이트
        setHistory((prev) =>
          prev.map((doc) =>
            doc.id === editingDocId
              ? {
                  ...doc,
                  fileName: editingFileName,
                  extracted_text: editingExtractedText,
                  summary: editingSummary,
                  is_important: editingIsImportant,
                }
              : doc,
          ),
        );
        alert("문서 정보가 성공적으로 수정되었습니다.");
        setShowSummaryEditModal(false);
        setEditingDocId(null);
        setEditingFileName("");
        setEditingExtractedText("");
        setEditingSummary("");
        setEditingIsImportant(false);
        setEditingDocPassword("");
      } else {
        const error = await response.json();
        alert(error.detail || "문서 수정 실패");
      }
    } catch (error) {
      console.error("문서 수정 에러:", error);
      alert("문서 수정 중 오류가 발생했습니다.");
    }
  };

  // ===== [추가] 문서 삭제 함수 (일반 유저 및 관리자 공용) =====
  const handleDeleteDocument = async (docId, fileName) => {
    if (!window.confirm(`"${fileName}"을(를) 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const userDbId = localStorage.getItem("userDbId");

      const response = await fetch(
        `http://localhost:8000/api/summarize/${docId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `user_id=${userDbId}`,
        },
      );

      if (response.ok) {
        // 히스토리에서 삭제
        setHistory((prev) => prev.filter((doc) => doc.id !== docId));
        alert("문서가 성공적으로 삭제되었습니다.");
      } else {
        const error = await response.json();
        alert(error.detail || "문서 삭제 실패");
      }
    } catch (error) {
      console.error("문서 삭제 에러:", error);
      alert("문서 삭제 중 오류가 발생했습니다.");
    }
  };

  // ===== [수정] 관리자 문서 삭제 함수 (제거됨 - handleDeleteDocument 통합) =====

  // ===== [추가] 공개/비공개 토글 함수 =====
  const handleTogglePublic = async (item) => {
    const newPublicStatus = !item.is_public;
    const userDbId = localStorage.getItem("userDbId");

    try {
      const response = await fetch(
        `http://localhost:8000/api/document/${item.id}/public`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: parseInt(userDbId),
            is_public: newPublicStatus ? 1 : 0,
          }),
        },
      );

      if (response.ok) {
        setHistory((prevHistory) =>
          prevHistory.map((doc) =>
            doc.id === item.id ? { ...doc, is_public: newPublicStatus } : doc,
          ),
        );
      }
    } catch (error) {
      console.error("토글 에러:", error);
    }
  };

  const handleDeleteAccount = async () => {
    if (
      window.confirm("정말로 탈퇴하시겠습니까? 모든 히스토리가 삭제됩니다.")
    ) {
      try {
        const userId = localStorage.getItem("userId");
        const response = await fetch(
          `http://localhost:8000/auth/withdraw/${userId}`,
          {
            method: "DELETE",
          },
        );

        if (response.ok) {
          alert("회원 탈퇴가 완료되었습니다.");
          localStorage.clear();
          window.location.href = "/";
        } else {
          alert("탈퇴 처리 중 오류가 발생했습니다.");
        }
      } catch (error) {
        console.error("탈퇴 에러:", error);
      }
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
        {/* ===== [추가] 왼쪽: 프로필 섹션 ===== */}
        <aside className="profile-card">
          <div className="profile-image">{userInfo.full_name[0]}</div>
          <h2 className="user-name">{userInfo.full_name}님</h2>
          <p className="user-id">@{userInfo.username}</p>
          {/* ===== [추가] 이메일 표시 ===== */}
          <p className="user-email">{userInfo.email}</p>
          {/* ===== [추가] 관리자 표시 ===== */}
          {userInfo.role === "admin" && (
            <p
              className="user-role"
              style={{ color: "red", fontWeight: "bold" }}
            >
              👨‍💼 관리자
            </p>
          )}
          <hr />
          <div className="stats">
            <div className="stat-item">
              <span className="stat-label">총 요약 건수</span>
              <span className="stat-value">{history.length}건</span>
            </div>
          </div>
          {/* ===== [수정] 프로필 수정 버튼 (관리자도 본인 프로필 수정 가능) ===== */}
          <button
            className="edit-btn"
            onClick={() => {
              setShowEditModal(true);
              setEditEmail(userInfo.email);
            }}
          >
            프로필 수정
          </button>
          <button className="delete-account-btn" onClick={handleDeleteAccount}>
            회원 탈퇴
          </button>
        </aside>

        {/* ===== [추가] 오른쪽: 활동 내역 섹션 ===== */}
        <main className="history-section">
          <h3 className="section-title">
            최근 요약 히스토리
            {userInfo.role === "admin" && " (전체)"}
          </h3>
          <div className="history-table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>파일명</th>
                  {/* ===== [추가] 관리자일 때 작성자 컬럼 표시 ===== */}
                  {userInfo.role === "admin" && <th>작성자</th>}
                  <th>모델</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length > 0 ? (
                  currentItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      {/* ===== [수정] 파일명 제대로 표시: title로 전체명 보기 가능, 긴 파일명은 말줄임표 =====*/}
                      <td className="file-name-cell" title={item.fileName}>
                        <span className="filename-text">{item.fileName}</span>
                        {/* ===== [추가] 중요 문서 아이콘 표시 ===== */}
                        {item.is_important && (
                          <span title="중요 문서(비밀번호 설정)">🔒</span>
                        )}
                      </td>
                      {/* ===== [추가] 관리자일 때 작성자 정보 표시 ===== */}
                      {userInfo.role === "admin" && (
                        <td>
                          <div
                            style={{
                              fontSize: "12px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
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
                        {/* ===== [추가] 보기, 편집, 공개/비공개, 삭제 버튼 ===== */}
                        <button
                          className="action-btn view"
                          onClick={() => handleViewDocument(item)}
                        >
                          보기
                        </button>
                        <button
                          className="action-btn edit"
                          onClick={() => handleEditSummary(item.id)}
                        >
                          편집
                        </button>
                        {/* ===== [추가] 공개/비공개 토글 버튼 ===== */}
                        <button
                          className={`action-btn ${item.is_public ? "public" : "private"}`}
                          onClick={() => handleTogglePublic(item)}
                        >
                          {item.is_public ? "🌐 공개" : "🔒 비공개"}
                        </button>
                        {/* ===== [수정] 일반 유저와 관리자 모두 동일한 삭제 함수 사용 ===== */}
                        <button
                          className="action-btn delete"
                          onClick={() =>
                            handleDeleteDocument(item.id, item.fileName)
                          }
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={userInfo.role === "admin" ? 6 : 5}
                      style={{ textAlign: "center", padding: "20px" }}
                    >
                      히스토리가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ===== [추가] 페이지네이션 UI ===== */}
          {history.length > 0 && (
            <div className="pagination">
              {/* 이전 페이지 버튼 */}
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                ❮ 이전
              </button>

              {/* 페이지 번호 */}
              <div className="pagination-numbers">
                {Array.from({ length: totalPages }, (_, i) => {
                  // ===== [추가] 많은 페이지 수일 경우 현재 페이지 주변만 표시 =====
                  const pageNum = i + 1;
                  const isVisible =
                    pageNum === 1 ||
                    pageNum === totalPages ||
                    (pageNum >= currentPage - 1 && pageNum <= currentPage + 1);

                  if (!isVisible && i !== 0 && i !== 1) {
                    return null;
                  }

                  if (!isVisible && (i === 1 || i === totalPages - 2)) {
                    return (
                      <span key={`dots-${i}`} className="pagination-dots">
                        ...
                      </span>
                    );
                  }

                  return (
                    <button
                      key={pageNum}
                      className={`pagination-number ${currentPage === pageNum ? "active" : ""}`}
                      onClick={() => setCurrentPage(pageNum)}
                    >
                      {pageNum}
                    </button>
                  );
                }).filter(Boolean)}
              </div>

              {/* 다음 페이지 버튼 */}
              <button
                className="pagination-btn"
                onClick={() =>
                  setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                }
                disabled={currentPage === totalPages}
              >
                다음 ❯
              </button>
            </div>
          )}

          {/* ===== [추가] 페이지 정보 표시 ===== */}
          {history.length > 0 && (
            <div className="pagination-info">
              <span>
                {currentPage} / {totalPages} 페이지
              </span>
              <span>({history.length}개 항목)</span>
            </div>
          )}
        </main>
      </div>

      {/* ===== [추가] 프로필 수정 모달 ===== */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>프로필 수정</h2>
            <div className="modal-body">
              <div className="form-group">
                <label>현재 이메일</label>
                <input type="text" value={userInfo.email} disabled />
              </div>
              <div className="form-group">
                <label>새 이메일 (선택)</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="변경할 이메일을 입력하세요"
                />
              </div>
              <div className="form-group">
                <label>새 비밀번호 (선택, 6자 이상)</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="변경할 비밀번호를 입력하세요"
                />
              </div>
              <div className="form-group">
                <label>현재 비밀번호 (필수)</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="현재 비밀번호를 입력하세요"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setShowEditModal(false)}
                disabled={editLoading}
              >
                취소
              </button>
              <button
                className="btn-confirm"
                onClick={handleEditProfile}
                disabled={editLoading}
              >
                {editLoading ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== [추가] 문서 상세보기 모달 ===== */}
      {showDetailModal && selectedDocument && (
        <div
          className="modal-overlay"
          onClick={() => setShowDetailModal(false)}
        >
          <div
            className="modal-content modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{selectedDocument.filename}</h2>
            <div className="modal-body document-detail">
              <div className="detail-section">
                <h3>📝 원문 요약</h3>
                <p>{selectedDocument.summary}</p>
              </div>
              <div className="detail-section">
                <h3>📄 전체 추출 텍스트</h3>
                <div className="text-preview">
                  {selectedDocument.extracted_text}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setShowDetailModal(false)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== [수정] 문서 편집 모달 - 파일명, 원문, 요약, 비밀번호 모두 수정 가능 ===== */}
      {showSummaryEditModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowSummaryEditModal(false)}
        >
          <div
            className="modal-content modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>문서 정보 수정</h2>
            <div className="modal-body edit-modal-body">
              {/* ===== [추가] 파일명 입력 필드 ===== */}
              <div className="form-group">
                <label>파일명</label>
                <input
                  type="text"
                  value={editingFileName}
                  onChange={(e) => setEditingFileName(e.target.value)}
                  placeholder="파일명을 입력하세요"
                  className="form-input"
                />
              </div>

              {/* ===== [추가] 중요 문서 설정 체크박스 ===== */}
              <div
                className="form-group"
                style={{
                  marginBottom: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <label
                  style={{
                    fontWeight: "bold",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    margin: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editingIsImportant}
                    onChange={(e) => {
                      setEditingIsImportant(e.target.checked);
                      if (!e.target.checked) setEditingDocPassword(""); // 해제 시 비번 초기화
                    }}
                    style={{
                      width: "18px",
                      height: "18px",
                      marginRight: "8px",
                    }}
                  />
                  🔒 이 문서를 중요 문서로 설정 (비밀번호 보호)
                </label>
              </div>

              {/* ===== [추가] 중요 문서 체크 시에만 비밀번호 입력란 표시 ===== */}
              {editingIsImportant && (
                <div
                  className="form-group password-edit-box"
                  style={{
                    backgroundColor: "#fff5f5",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid #feb2b2",
                    marginBottom: "15px",
                  }}
                >
                  <label
                    style={{
                      color: "#c53030",
                      fontWeight: "bold",
                      display: "block",
                      marginBottom: "5px",
                    }}
                  >
                    설정할 비밀번호 (숫자 4자리)
                  </label>
                  <input
                    type="text"
                    maxLength="4"
                    value={editingDocPassword}
                    onChange={(e) =>
                      setEditingDocPassword(
                        e.target.value.replace(/[^0-9]/g, ""),
                      )
                    }
                    placeholder="비밀번호 4자리 입력"
                    className="form-input"
                    style={{ border: "1px solid #fc8181", marginTop: "5px" }}
                  />
                </div>
              )}

              {/* ===== [추가] 원문 입력 필드 ===== */}
              <div className="form-group">
                <label>원문</label>
                <textarea
                  className="form-textarea large-textarea"
                  value={editingExtractedText}
                  onChange={(e) => setEditingExtractedText(e.target.value)}
                  placeholder="원문을 수정하세요"
                  rows="8"
                />
              </div>

              {/* ===== [추가] 요약 입력 필드 ===== */}
              <div className="form-group">
                <label>요약</label>
                <textarea
                  className="summary-textarea"
                  value={editingSummary}
                  onChange={(e) => setEditingSummary(e.target.value)}
                  placeholder="요약을 수정하세요"
                  rows="8"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setShowSummaryEditModal(false)}
              >
                취소
              </button>
              <button className="btn-confirm" onClick={handleSaveSummary}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== [추가] 회원 관리 모달 ===== */}
    </div>
  );
};

export default MyPage;
