// src/pages/UserList.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from 'react-router-dom';
import { useSessionValidator } from '../hooks/useSessionValidator';
import { useLogout } from '../hooks/useLogout';
import "./UserList.css";

// ────────────────────────────────────────────────────────────────
// 메인 컴포넌트 : 전체 요약 목록 페이지
// ────────────────────────────────────────────────────────────────
const UserList = () => {

  const navigate = useNavigate();

    // ===== [추가] 세션 유효성 검증 (10분 주기, 강제 로그아웃 대상은 즉시+5초) =====
    useSessionValidator(); // 기본값 10분, 강제 로그아웃 대상이면 즉시+5초 주기로 검증

    console.log("📄 PdfSummary 컴포넌트 렌더링됨");
    const API_BASE = "http://localhost:8000/api";

    // ===== [추가] 로그인 정보 확인 =====
    const handleLogout = useLogout(null, { showAlert: false });
    
    useEffect(() => {
      const userDbId = localStorage.getItem('userDbId');
      const sessionToken = localStorage.getItem('session_token');
      
      if (!userDbId || !sessionToken) {
        console.log('로그인 정보 없음, 로그아웃 처리');
        handleLogout();
      }
    }, []); // 마운트할 때 한 번만 실행
  
  const currentUser = localStorage.getItem("userName");
  const currentUserIdStr = localStorage.getItem("userDbId");
  const currentUserId = currentUserIdStr ? Number(currentUserIdStr) : null;
  const userRole = localStorage.getItem("userRole") || "";
  const isAdmin = userRole.trim().toLowerCase() === "admin";
  // const isAdmin = true; // 테스트용 강제 ON

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState("최신순");
  const [modelFilter, setModelFilter] = useState("전체 모델");
  const [publicFilter, setPublicFilter] = useState("all");
  const [importantFilter, setImportantFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("전체");

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);

  // [정재훈] 2026-03-02 추가: 체크박스 선택 상태
  const [selectedItems, setSelectedItems] = useState([]);

  // [재훈] 2026-03-01 추가: 요약 보기 모달
  const [selectedSummary, setSelectedSummary] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null); // 전체 문서 객체 (extracted_text 포함)

  // [재훈] 2026-03-03 추가: 중요문서 비밀번호 모달
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordDocId, setPasswordDocId] = useState(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false); // ← 이 줄 추가
  // [정재훈] 2026-03-02 추가: 정렬 상태
  const [sortConfig, setSortConfig] = useState({ key: "id", direction: "asc" });

  // [재훈] 2026-03-03 추가: 동적 모델 목록 (전체 모델 필터 옵션)
  const [availableModels, setAvailableModels] = useState(["전체 모델"]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // ────────────────────────────────────────────────────────────────
        // [추가] 사용자 role 정보 가져오기 (이미 있는 API 활용)
        // ────────────────────────────────────────────────────────────────
        const userDbId = localStorage.getItem("userDbId");
        if (userDbId) {
          try {
            const profileRes = await fetch(
              `http://localhost:8000/auth/profile/${userDbId}`,
            );
            if (profileRes.ok) {
              const profileData = await profileRes.json();
              localStorage.setItem("userRole", profileData.role);
              console.log("profile에서 가져온 role:", profileData.role);
            }
          } catch (err) {
            console.error("role 가져오기 실패:", err);
          }
        }

        // 문서 목록 불러오기
        const docRes = await fetch("http://localhost:8000/api/admin/documents");
        if (!docRes.ok) throw new Error("문서 목록 불러오기 실패");
        const docResult = await docRes.json();

        const mappedData = docResult.documents.map((doc, index) => {
          const createdDate = doc.created_at ? new Date(doc.created_at) : null;
          return {
            id: Number(doc.id || index + 1),
            userId: doc.user?.id ?? null,
            username: doc.user?.username || "알수없음",
            fullName: doc.user?.full_name || doc.user?.username || "알수없음",
            datetime: createdDate
              ? createdDate
                  .toLocaleString("ko-KR", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                  .replace(/\. /g, "-")
                  .replace(" ", "\n")
              : "날짜 없음",
            filename: doc.filename || "파일명 없음",
            model: doc.model_used || "gemma3:latest",
            charCount: doc.char_count ? doc.char_count.toLocaleString() : "0",
            status: "완료",
            summary: doc.summary || "요약 내용이 없습니다.",
            extracted_text: doc.extracted_text || "",
            sortDate: createdDate,
            isPublic: doc.is_public ?? true,
            isImportant: doc.is_important ?? false,
            password: doc.password ?? null,
            category: doc.category || "기타", // ← 추가
          };
        });

        setData(mappedData);

        // 동적 모델 목록 불러오기 (필터 옵션용)
        const modelRes = await fetch("http://localhost:8000/api/models");
        if (modelRes.ok) {
          const modelResult = await modelRes.json();
          if (modelResult.models && modelResult.models.length > 0) {
            setAvailableModels(["전체 모델", ...new Set(modelResult.models)]);
          }
        }
      } catch (err) {
        setError(err.message);
        console.error("데이터 로드 오류:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const role = localStorage.getItem("userRole");
    console.log(
      "userRole 키 존재 여부:",
      localStorage.getItem("userRole") !== null,
    );
    console.log("userRole 원본 값:", role);
    console.log("JSON.stringify로 본 원본:", JSON.stringify(role));
    console.log("trim 후:", role?.trim());
    console.log("trim + lowercase:", role?.trim().toLowerCase());
    console.log("admin 비교 결과:", role?.trim().toLowerCase() === "admin");
    console.log("localStorage 전체 키 목록:", Object.keys(localStorage));
  }, []);

  // 테이블 상단에 컬럼 정의 배열 만들기
  const columns = [
    { key: null, label: "선택", width: "40px", sortable: false },
    { key: "id", label: "#", sortable: true },
    { key: "datetime", label: "날짜 / 시간", sortable: true },
    { key: "username", label: "ID", sortable: true },
    { key: "fullName", label: "사용자", sortable: true },
    { key: "filename", label: "파일명", sortable: true },
    { key: "model", label: "AI 모델", sortable: true },
    { key: "charCount", label: "원문자수", sortable: true },
    { key: "category", label: "분류", sortable: true },
    { key: "isPublic", label: "공개여부", sortable: true },
    { key: "isImportant", label: "중요", sortable: true },
    { key: null, label: "상태", sortable: false },
    { key: null, label: "보기", sortable: false },
  ];

  // [재훈] 2026-03-03 안전한 본인 문서 판단 함수 (한 번만 선언)
  const isMyDocument = (item) => {
    if (!currentUserId || isNaN(currentUserId)) return false;
    const docUserId = Number(item.userId);
    if (isNaN(docUserId)) return false; // "N/A" 등 문자열이면 false
    return currentUserId === docUserId;
  };

  // [재훈] 2026-03-03 체크박스 활성화 조건: 공개 문서 OR 본인 문서
  const canCheck = (item) => item.isPublic || isMyDocument(item);

  // 보기 버튼 활성화 조건: 공개 OR 본인
  const canView = (item) => {
    if (isAdmin) {
      return true; // 관리자는 모든 문서 볼 수 있음 (비공개 포함)
    }
    return item.isPublic || isMyDocument(item);
  };

  // handleCheckboxChange 함수 (ID를 항상 Number로 저장)
  const handleCheckboxChange = (docId) => {
    const numericId = Number(docId);
    if (isNaN(numericId) || numericId <= 0) return;

    const doc = data.find((item) => Number(item.id) === numericId);
    if (!doc || !(doc.isPublic || isMyDocument(doc) || isAdmin)) return;

    setSelectedItems((prev) => {
      const newSelection = prev.includes(numericId)
        ? prev.filter((id) => id !== numericId)
        : [...prev, numericId];
      console.log("체크 변경 후 selectedItems:", newSelection); // 디버깅 로그
      return newSelection;
    });
  };

  // 문서 다운로드 (기존 함수를 아래로 완전히 교체)
  const handleDownload = async () => {
    if (selectedItems.length === 0) {
      alert("다운로드할 항목을 선택하세요.");
      return;
    }

    const safeSelectedIds = selectedItems
      .map(Number)
      .filter((id) => !isNaN(id) && id > 0);

    // 선택된 문서 중 중요 문서가 있는지 확인
    const importantDocs = data.filter(
      (item) => safeSelectedIds.includes(Number(item.id)) && item.isImportant,
    );
    const hasImportant = importantDocs.length > 0;

    // 중요 문서가 있으면 사용자에게 미리 알림 + 예시 보여주기
    if (hasImportant) {
      // 중요 문서 목록 미리 보여줘서 직관적으로 이해시키기 (최대 5개까지만 예시)
      const importantList = importantDocs
        .slice(0, 5)
        .map(
          (item) =>
            `  • ID ${item.id} - ${item.filename.slice(0, 30)}${item.filename.length > 30 ? "..." : ""}`,
        )
        .join("\n");

      const moreCount =
        importantDocs.length > 5
          ? `\n  (외 ${importantDocs.length - 5}개)`
          : "";

      const confirmMsg =
        `중요 문서가 포함되어 있습니다. (${importantDocs.length}개)\n\n` +
        `ZIP 파일로 다운로드합니다.\n` +
        `• 일반 문서: 바로 열림\n` +
        `• 중요 문서: 업로드 시 입력한 4자리 숫자 비밀번호를 사용하세요!\n\n` +
        `비밀번호 예시:\n` +
        `  • 업로드 시 1234 입력 → 비밀번호 1234\n` +
        `  • 업로드 시 5678 입력 → 비밀번호 5678\n\n` +
        `다운로드 진행할까요?`;

      if (!window.confirm(confirmMsg)) return;
    }

    try {
      const response = await fetch(
        "http://localhost:8000/api/admin/download-selected",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selected_ids: safeSelectedIds,
            user_id: currentUserId,
            format: hasImportant ? "zip" : "csv", // 중요 있으면 zip, 없으면 csv
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`다운로드 실패: ${response.status} - ${errText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      // 파일명도 중요 여부에 따라 다르게
      const filename = hasImportant
        ? `${currentUser}_보호된_요약목록.zip`
        : `${currentUser}_선택_요약목록.csv`;

      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      console.log("✅ 다운로드 성공");
      alert(
        hasImportant
          ? "ZIP 파일 다운로드 완료!\n중요 문서는  입력한 4자리 번호를 비밀번호로 사용하세요."
          : "CSV 파일 다운로드 완료!",
      );
    } catch (err) {
      console.error("다운로드 오류:", err);
      alert("다운로드 실패: " + err.message);
    }
  };

  //handleViewClick – 중요 문서 부분에 관리자 예외
  const handleViewClick = (docId) => {
    const doc = data.find((item) => item.id === docId);
    if (!doc) {
      alert("해당 문서를 찾을 수 없습니다.");
      return;
    }

    // 관리자도 아닌데 볼 수 없는 문서라면 차단
    if (!isAdmin && !canView(doc)) {
      alert("이 문서는 비공개입니다. 작성자만 볼 수 있습니다.");
      return;
    }

    // 전체 문서 객체 저장 (extracted_text 포함)
    setSelectedDoc(doc);
    setSelectedSummary(doc.summary); // 기존 요약 상태도 유지

    if (doc.isImportant) {
      if (isAdmin) {
        setIsModalOpen(true);
        return;
      }
      setPasswordDocId(doc.id);
      setPasswordInput("");
      setIsPasswordModalOpen(true);
    } else {
      setIsModalOpen(true);
    }
  };

  // 비밀번호 제출 성공 시에도 전체 doc 저장
  const handlePasswordSubmit = () => {
    const doc = data.find((item) => item.id === passwordDocId);
    if (!doc) return;

    if (isAdmin || doc.password === passwordInput) {
      setSelectedDoc(doc); // ← 여기 추가 (전체 객체 저장)
      setSelectedSummary(doc.summary);
      setIsModalOpen(true);
      setIsPasswordModalOpen(false);
      setPasswordDocId(null);
      setPasswordInput("");
    } else {
      alert("비밀번호가 틀렸습니다.");
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedSummary(null);
    setPasswordDocId(null);
    setPasswordInput("");
    setIsPasswordModalOpen(false);
  };

  //정렬 key 값
  const requestSort = (key) => {
    if (!key) return;

    let direction = "asc";

    if (sortConfig.key === key) {
      // 같은 컬럼 다시 클릭하면 방향 반전
      direction = sortConfig.direction === "asc" ? "desc" : "asc";
    } else {
      // ==================== 컬럼별 첫 클릭 방향 정의 ====================
      switch (key) {
        case "id": // #
          direction = "asc"; // 작은 수부터
          break;
        case "charCount": // 원문자수
          direction = "desc"; // 큰 수부터
          break;
        case "isImportant": // 중요
          direction = "desc"; // 중요(true) 먼저
          break;
        case "datetime": // 날짜/시간
          direction = "desc"; // 최신순부터
          break;
        case "isPublic": // 공개여부
          direction = "desc"; // 공개 먼저
          break;
        default:
          direction = "asc"; // 나머지 (사용자, 파일명, 모델, 분류 등)는 오름차순
      }
    }

    setSortConfig({ key, direction });
    setSortOption("");
    setCurrentPage(1);
  };

  if (loading)
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        데이터 로딩 중...
      </div>
    );
  if (error)
    return <div style={{ padding: "40px", color: "red" }}>오류: {error}</div>;

  let filteredData = data.filter(
    (item) =>
      (item.filename || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.fullName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.username || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.model || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.status || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(item.charCount || "").includes(searchTerm) ||
      (item.datetime || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.filename || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.fullName || "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // 공개/비공개 기본 권한 필터 (이 부분만 수정)
  filteredData = filteredData.filter((item) => {
    if (isAdmin) {
      return true; // 관리자는 모든 문서 (비공개 포함) 다 봄
    }
    return isMyDocument(item) || item.isPublic; // 일반 유저는 본인 + 공개만
  });

  // 모델 필터 (기존)
  if (modelFilter !== "전체 모델") {
    filteredData = filteredData.filter((item) => item.model === modelFilter);
  }

  // 새로 추가: 분류 필터
  if (categoryFilter !== "전체") {
    filteredData = filteredData.filter(
      (item) => item.category === categoryFilter,
    );
  }

  // 공개여부 필터 (새로 추가)
  if (publicFilter === "public") {
    filteredData = filteredData.filter((item) => item.isPublic);
  } else if (publicFilter === "private") {
    filteredData = filteredData.filter((item) => !item.isPublic);
  }
  // "all"이면 필터링 안 함

  // 중요 여부 필터 (새로 추가)
  if (importantFilter === "important") {
    filteredData = filteredData.filter((item) => item.isImportant);
  } else if (importantFilter === "normal") {
    filteredData = filteredData.filter((item) => !item.isImportant);
  }
  // "all"이면 필터링 안 함

  if (sortOption === "최신순") {
    filteredData.sort(
      (a, b) => (b.sortDate || new Date(0)) - (a.sortDate || new Date(0)),
    );
  } else if (sortOption === "오래된순") {
    filteredData.sort(
      (a, b) => (a.sortDate || new Date(0)) - (b.sortDate || new Date(0)),
    );
  }

  // 필터링 모두 끝난 후 (publicFilter, importantFilter 등 다 끝난 직후)
  // 페이지네이션 직전 위치에 넣으세요

  // ────────────────────────────────────────────────
  // 정렬 적용 : 컬럼 헤더가 있으면 컬럼 우선, 없으면 드롭다운 적용
  // ────────────────────────────────────────────────
  if (sortConfig.key) {
    // 컬럼 헤더 정렬이 선택된 경우 → 그대로 유지 (이미 잘 동작한다고 하셨으니)
    filteredData.sort((a, b) => {
      const key = sortConfig.key;
      const dir = sortConfig.direction;

      // ID
      if (key === "id") {
        return dir === "asc"
          ? (Number(a.id) || 0) - (Number(b.id) || 0)
          : (Number(b.id) || 0) - (Number(a.id) || 0);
      }

      // 원문자수
      if (key === "charCount") {
        const aCount = Number(String(a.charCount).replace(/[^0-9]/g, "")) || 0;
        const bCount = Number(String(b.charCount).replace(/[^0-9]/g, "")) || 0;
        return dir === "asc" ? aCount - bCount : bCount - aCount;
      }

      // 중요도
      if (key === "isImportant") {
        const aImp = a.isImportant === true ? 1 : 0;
        const bImp = b.isImportant === true ? 1 : 0;
        if (aImp !== bImp) {
          return dir === "desc" ? bImp - aImp : aImp - bImp;
        }
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      }

      // 날짜
      if (key === "datetime") {
        const dateA = new Date(a.sortDate || a.datetime || 0);
        const dateB = new Date(b.sortDate || b.datetime || 0);
        return dir === "asc" ? dateA - dateB : dateB - dateA;
      }

      // 일반 숫자
      const aValue = a[key];
      const bValue = b[key];
      if (typeof aValue === "number" && typeof bValue === "number") {
        return dir === "asc" ? aValue - bValue : bValue - aValue;
      }

      // 문자열
      const strA = String(aValue || "").toLowerCase();
      const strB = String(bValue || "").toLowerCase();
      return dir === "asc"
        ? strA.localeCompare(strB)
        : strB.localeCompare(strA);
    });
  } else {
    // 컬럼 헤더 정렬이 없을 때만 → 드롭다운(최신순/오래된순) 적용
    if (sortOption === "최신순") {
      filteredData.sort((a, b) => {
        const timeA = a.sortDate instanceof Date ? a.sortDate.getTime() : 0;
        const timeB = b.sortDate instanceof Date ? b.sortDate.getTime() : 0;
        return timeB - timeA; // 최신(큰 시간값) → 위로
      });
    } else if (sortOption === "오래된순") {
      filteredData.sort((a, b) => {
        const timeA = a.sortDate instanceof Date ? a.sortDate.getTime() : 0;
        const timeB = b.sortDate instanceof Date ? b.sortDate.getTime() : 0;
        return timeA - timeB; // 오래된(작은 시간값) → 위로
      });
    }
    // else → 아무 정렬 안 함 (필요하면 기본 정렬 추가 가능)
  }

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentItems = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  const highlightText = (text, term) => {
    if (!term || !text) return text || "";
    try {
      const regex = new RegExp(
        `(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi",
      );
      return text.replace(regex, '<span class="highlight">$1</span>');
    } catch {
      return text;
    }
  };

  return (
    <div className="summary-list-page">
      {/* 제목 */}
      <div className="title-wrapper">
        <div className="title-bar"></div>
        <h2>요약 목록</h2>
      </div>

      {/* 설명 + 다운로드 */}
      <div className="description-wrapper">
        <div className="description-box">
          📝 전체 사용자의 요약 이력을 조회할 수 있습니다. (본인 포함 전체 공개)
          <button className="download-btn" onClick={handleDownload}>
            선택 항목 다운로드
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div className="filter-container">
        <div className="filter-bar">
          <div className="search-group">
            <input
              type="text"
              placeholder="파일명, 사용자, 날짜 등 검색..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
            <span className="search-icon">🔍</span>
          </div>

          <select
            value={sortOption}
            onChange={(e) => {
              const value = e.target.value;
              setSortOption(value);
              setSortConfig({ key: null, direction: "asc" }); // ← 이 줄이 없으면 안 됨!
              setCurrentPage(1);
            }}
          >
            <option value="최신순">최신순</option>
            <option value="오래된순">오래된순</option>
          </select>

          {/* 새로 추가: 분류 필터 */}
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="전체">분류: 전체</option>
            <option value="강의">강의</option>
            <option value="법률안">법률안</option>
            <option value="보고서">보고서</option>
            <option value="기타">기타</option>
          </select>

          <select
            value={modelFilter}
            onChange={(e) => {
              setModelFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            value={publicFilter}
            onChange={(e) => {
              setPublicFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="public">공개된 문서</option>
            <option value="all">전체 (내 비공개 포함)</option>
            <option value="private">내 비공개 문서</option>
          </select>

          <button className="search-btn">검색</button>
        </div>
      </div>

      {/* 테이블 */}
      <div className="table-wrapper">
        <table className="summary-table">
          <thead>
            <tr>
              {columns.map((col, index) => (
                <th
                  key={index}
                  style={col.width ? { width: col.width } : undefined}
                  className={col.sortable ? "sortable" : ""}
                  onClick={
                    col.sortable ? () => requestSort(col.key) : undefined
                  }
                >
                  {/* 첫 번째 컬럼(선택)일 때만 체크박스 추가 */}
                  {index === 0 && (
                    <input
                      type="checkbox"
                      checked={
                        filteredData.length > 0 &&
                        filteredData.every((item) =>
                          selectedItems.includes(Number(item.id)),
                        )
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          // 현재 필터링된 행 중 아직 선택 안 된 것들만 추가
                          const newlySelected = filteredData
                            .filter(
                              (item) =>
                                !selectedItems.includes(Number(item.id)),
                            )
                            .map((item) => Number(item.id));
                          setSelectedItems((prev) => {
                            const updated = [...prev, ...newlySelected];
                            return [...new Set(updated)]; // 중복 제거 (안전)
                          });
                        } else {
                          // 현재 필터링된 행만 해제 (전체 지우지 않음)
                          const currentPageIds = new Set(
                            filteredData.map((item) => Number(item.id)),
                          );
                          setSelectedItems((prev) =>
                            prev.filter((id) => !currentPageIds.has(id)),
                          );
                        }
                      }}
                      disabled={filteredData.length === 0}
                    />
                  )}
                  {col.label}

                  {col.sortable && (
                    <span
                      className={`sort-icon ${sortConfig.key === col.key ? sortConfig.direction : "none"}`}
                    >
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
            {currentItems.map((item) => (
              <tr key={item.id} className={isMyDocument(item) ? "my-item" : ""}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(Number(item.id))}
                    onChange={() =>
                      handleCheckboxChange(
                        item.id,
                        item.username,
                        item.fullName,
                      )
                    }
                    disabled={!(item.isPublic || isMyDocument(item) || isAdmin)} // 공개 = 체크 가능, 비공개 = 본인만 가능 , 관리자 전부 허용
                  />
                </td>
                <td>{item.id}</td>
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.datetime, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.username, searchTerm),
                  }}
                />
                <td
                  className="user-cell"
                  data-username={item.username}
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.fullName, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.filename, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.model, searchTerm),
                  }}
                />
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.charCount, searchTerm),
                  }}
                />
                {/* 추가: 분류 td */}
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.category || "기타", searchTerm),
                  }}
                />
                <td>
                  {item.isPublic ? (
                    <span className="status-badge public">공개</span>
                  ) : (
                    <span className="status-badge private">비공개</span>
                  )}
                </td>
                <td>
                  {item.isImportant ? (
                    <span className="status-badge important">중요</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td
                  dangerouslySetInnerHTML={{
                    __html: highlightText(item.status, searchTerm),
                  }}
                />
                <td>
                  <button
                    className="view-btn"
                    onClick={() => handleViewClick(item.id)}
                    disabled={!canView(item)}
                  >
                    보기
                  </button>
                </td>
              </tr>
            ))}

            {Array.from({ length: itemsPerPage - currentItems.length }).map(
              (_, i) => (
                <tr key={`empty-${i}`} className="empty-row">
                  <td colSpan={13}>&nbsp;</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* 요약 모달 */}
      {isModalOpen && selectedDoc && (
        <div className="custom-modal-overlay" onClick={closeModal}>
          <div
            className="custom-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="custom-modal-header">
              <h2>문서 상세 내용</h2>
              <button className="custom-close-btn" onClick={closeModal}>
                ×
              </button>
            </div>

            <div className="custom-modal-body">
              <div className="document-detail-container">
                {/* 원본 섹션 */}
                <section className="section-original">
                  <h3 className="section-title">원본 추출 텍스트</h3>
                  <pre className="modal-text modal-original-text">
                    {selectedDoc.extracted_text || "원본 텍스트가 없습니다."}
                  </pre>
                </section>

                <hr className="section-divider" />

                {/* 요약 섹션 */}
                <section className="section-summary">
                  <h3 className="section-title">요약 내용</h3>
                  <pre className="modal-text modal-summary-text">
                    {selectedDoc.summary || "요약 내용이 없습니다."}
                  </pre>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 모달 */}
      {isPasswordModalOpen &&
        passwordDocId && ( // ← passwordDocId만 쓰지 말고 isPasswordModalOpen && 로 복구
          <div
            className="modal-overlay password-modal-overlay"
            onClick={() => setIsPasswordModalOpen(false)} // ← overlay 클릭 시 모달 닫기
          >
            <div
              className="modal-content password-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="modal-close password-modal-close"
                onClick={() => {
                  setPasswordInput("");
                  setPasswordDocId(null);
                  setIsPasswordModalOpen(false); // ← 여기 추가 (필수!)
                }}
              >
                ×
              </button>
              <h2>비밀번호 입력</h2>
              <p>중요 문서입니다. 4자리 비밀번호를 입력하세요.</p>
              <input
                type="password"
                maxLength={4}
                value={passwordInput}
                onChange={(e) =>
                  setPasswordInput(e.target.value.replace(/\D/g, ""))
                }
                placeholder="••••"
                autoFocus
                tabIndex={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault(); // 기본 엔터 동작 방지 (폼 제출 등)
                    handlePasswordSubmit(); // 엔터 누르면 확인 버튼과 똑같이 동작
                  }
                }}
              />

              <button
                onClick={handlePasswordSubmit}
                style={{
                  padding: "10px 20px",
                  background: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                }}
              >
                확인
              </button>
            </div>
          </div>
        )}

      {/* 페이지네이션 */}
      <div className="list-bottom-bar">
        <div className="pagination-left">
          <div className="my-summary-indicator">
            <span className="blue-bar"></span>
            <span className="my-summary-text">= 내가 요약한 항목</span>
          </div>
        </div>

        <div className="pagination">
          <button
            className="page-arrow"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            &lt;
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              className={`page-number ${currentPage === page ? "active" : ""}`}
              onClick={() => goToPage(page)}
            >
              {page}
            </button>
          ))}
          <button
            className="page-arrow"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            &gt;
          </button>
        </div>

        <div className="items-per-page">
          페이지당
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
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

      <div className="bottom-notes-grid">
        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">🔍</span> 검색 / 필터
          </div>
          <p>• 파일명 또는 사용자 이름 검색</p>
          <p>• 모델 및 정렬 기준 선택 가능</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">📋</span> 목록 보기
          </div>
          <p>• 전체 사용자의 요약 이력 조회</p>
          <p>• 기본 정렬 : 최신순</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon blue-dot">●</span> 내 항목 강조
          </div>
          <p>• 내가 작성한 요약은 파란 배경</p>
          <p>• 왼쪽에 파란색 바 표시</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">👁️</span> 상세 보기
          </div>
          <p>• 보기 버튼 클릭 시 요약 내용 확인</p>
          <p>• 원문 + 요약 결과 표시 예정</p>
        </div>

        <div className="note-box">
          <div className="note-title">
            <span className="note-icon">📄</span> 페이지네이션
          </div>
          <p>• 페이지당 5~100건 선택 가능</p>
          <p>• 총 건수 실시간 표시</p>
        </div>
      </div>
    </div>
  );
};

export default UserList;