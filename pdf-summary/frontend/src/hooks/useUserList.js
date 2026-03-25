// src/hooks/useUserList.js
import { useState, useEffect, useCallback } from "react";
import { useSessionValidator } from "./useSessionValidator";
import { useLogout } from "./useLogout";
import { buildApiUrl } from "../config/api";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

export const useUserList = () => {
  useSessionValidator(); // 세션 검증
  const handleLogout = useLogout(null, { showAlert: false });

  const currentUser = localStorage.getItem("userName") || "Guest";
  const currentUserId = Number(localStorage.getItem("userDbId")) || null;
  const userRole = localStorage.getItem("userRole") || "";
  const isAdmin = userRole.trim().toLowerCase() === "admin";

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordDocId, setPasswordDocId] = useState(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const [sortConfig, setSortConfig] = useState({
    key: "sortDate",
    direction: "asc",
  });
  const [availableModels, setAvailableModels] = useState(["전체 모델"]);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const [filters, setFilters] = useState({
    searchTerm: "",
    sortOption: "최신순",
    modelFilter: "전체 모델",
    publicFilter: "all",
    importantFilter: "all",
    categoryFilter: "전체",
    activePreset: "all",
    dateFilter: { type: "all", preset: null, range: { start: "", end: "" } },
  });

  const validateLocalStorage = useCallback(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");
    return (
      userDbId &&
      userDbId !== "null" &&
      userDbId.trim() !== "" &&
      !isNaN(Number(userDbId)) &&
      sessionToken &&
      sessionToken !== "null" &&
      sessionToken.trim() !== ""
    );
  }, []);

  // 데이터 로드
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        if (!validateLocalStorage()) {
          handleLogout();
          return;
        }

        const userDbId = localStorage.getItem("userDbId");
        const sessionToken = localStorage.getItem("session_token");

        // 역할 갱신
        const profileRes = await fetch(
          buildApiUrl(`/auth/profile/${userDbId}`),
          {
            headers: { Authorization: `Bearer ${sessionToken}` },
          },
        );
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          localStorage.setItem("userRole", profileData.role || "");
        }

        // 문서 목록 가져오기
        const docRes = await fetch(buildApiUrl("/api/admin/documents"), {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        if (!docRes.ok) throw new Error(`문서 목록 오류: ${docRes.status}`);
        const docResult = await docRes.json();

        const mappedData = docResult.documents.map((doc) => {
          const createdDate = doc.created_at ? new Date(doc.created_at) : null;
          return {
            id: Number(doc.id || 0),
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
            created_at: doc.created_at,
            isPublic: doc.is_public ?? true,
            isImportant: doc.is_important ?? false,
            password: doc.password ?? null,
            category: doc.category || "기타",
          };
        });
        setData(mappedData);

        // 모델 목록 가져오기
        const modelRes = await fetch(buildApiUrl("/api/documents/models"), {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (modelRes.ok) {
          const modelResult = await modelRes.json();
          if (modelResult.models?.length > 0) {
            setAvailableModels(["전체 모델", ...new Set(modelResult.models)]);
          }
        }
      } catch (err) {
        setError(err.message || "데이터 불러오기 실패");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [validateLocalStorage]);

  // 권한 확인 함수
  const isMyDocument = useCallback(
    (item) => currentUserId === Number(item.userId),
    [currentUserId],
  );
  const canCheck = useCallback(
    (item) => item.isPublic || isMyDocument(item) || isAdmin,
    [isMyDocument, isAdmin],
  );
  const canView = useCallback(
    (item) => isAdmin || item.isPublic || isMyDocument(item),
    [isAdmin, isMyDocument],
  );

  // 필터링 및 정렬 처리
  let filteredData = [...data];

  if (filters.searchTerm.trim()) {
    const term = filters.searchTerm.toLowerCase();
    filteredData = filteredData.filter((item) =>
      [
        item.filename,
        item.fullName,
        item.username,
        item.model,
        item.category,
        item.datetime,
      ].some((v) => v?.toLowerCase().includes(term)),
    );
  }

  if (filters.activePreset === "myDocs")
    filteredData = filteredData.filter(isMyDocument);
  else if (filters.activePreset === "important")
    filteredData = filteredData.filter((item) => item.isImportant);

  if (
    filters.dateFilter.type === "range" &&
    filters.dateFilter.range.start &&
    filters.dateFilter.range.end
  ) {
    const startDate = new Date(filters.dateFilter.range.start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(filters.dateFilter.range.end);
    endDate.setHours(23, 59, 59, 999);
    filteredData = filteredData.filter((item) => {
      if (!item.created_at) return false;
      const docDate = new Date(item.created_at);
      docDate.setHours(0, 0, 0, 0);
      return docDate >= startDate && docDate <= endDate;
    });
  }

  if (filters.dateFilter.type === "preset" && filters.dateFilter.preset) {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    if (
      filters.dateFilter.preset === "last7days" ||
      filters.dateFilter.preset === "7days"
    ) {
      startDate.setDate(startDate.getDate() - 6);
    } else if (filters.dateFilter.preset !== "today") {
      startDate = null;
    }
    if (startDate) {
      filteredData = filteredData.filter((item) => {
        if (!item.created_at) return false;
        const docDate = new Date(item.created_at);
        docDate.setHours(0, 0, 0, 0);
        return docDate >= startDate && docDate <= now;
      });
    }
  }

  if (filters.modelFilter !== "전체 모델")
    filteredData = filteredData.filter(
      (item) => item.model === filters.modelFilter,
    );
  if (filters.categoryFilter !== "전체")
    filteredData = filteredData.filter(
      (item) => item.category === filters.categoryFilter,
    );
  if (filters.publicFilter === "public")
    filteredData = filteredData.filter((item) => item.isPublic);
  else if (filters.publicFilter === "private")
    filteredData = filteredData.filter(
      (item) => !item.isPublic && isMyDocument(item),
    );
  if (filters.importantFilter === "important")
    filteredData = filteredData.filter((item) => item.isImportant);
  if (!isAdmin)
    filteredData = filteredData.filter(
      (item) => item.isPublic || isMyDocument(item),
    );

  if (sortConfig.key) {
    const dir = sortConfig.direction;
    filteredData.sort((a, b) => {
      const key = sortConfig.key;
      if (key === "datetime" || key === "sortDate") {
        return dir === "asc"
          ? new Date(a.sortDate || 0) - new Date(b.sortDate || 0)
          : new Date(b.sortDate || 0) - new Date(a.sortDate || 0);
      }
      if (key === "charCount") {
        const ca = Number(String(a.charCount).replace(/[^0-9]/g, "")) || 0;
        const cb = Number(String(b.charCount).replace(/[^0-9]/g, "")) || 0;
        return dir === "asc" ? ca - cb : cb - ca;
      }
      if (key === "isImportant") {
        const ia = a.isImportant ? 1 : 0;
        const ib = b.isImportant ? 1 : 0;
        if (ia !== ib) return dir === "desc" ? ib - ia : ia - ib;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      }
      const va = a[key],
        vb = b[key];
      if (typeof va === "number" && typeof vb === "number")
        return dir === "asc" ? va - vb : vb - va;
      const sa = String(va || "").toLowerCase(),
        sb = String(vb || "").toLowerCase();
      return dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentItems = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // 이벤트 핸들러들
  const handleCheckboxChange = (docId) => {
    const numericId = Number(docId);
    if (isNaN(numericId) || numericId <= 0) return;
    const doc = data.find((item) => Number(item.id) === numericId);
    if (!doc || !canCheck(doc)) return;
    setSelectedItems((prev) =>
      prev.includes(numericId)
        ? prev.filter((id) => id !== numericId)
        : [...prev, numericId],
    );
  };

  const handleViewClick = (docId) => {
    const doc = data.find((item) => item.id === docId);
    if (!doc || !canView(doc)) return toast.error("권한이 없습니다.");
    setSelectedDoc(doc);
    if (doc.isImportant && !isAdmin) {
      setPasswordDocId(doc.id);
      setPasswordInput("");
      setIsPasswordModalOpen(true);
    } else {
      setIsModalOpen(true);
    }
  };

  const handlePasswordSubmit = () => {
    if (!passwordDocId) return toast.error("문서 정보가 유효하지 않습니다.");
    const doc = data.find((item) => Number(item.id) === Number(passwordDocId));
    if (!doc) return toast.error("해당 문서를 찾을 수 없습니다.");
    if (String(doc.password || "") === passwordInput.trim()) {
      setIsPasswordModalOpen(false);
      setPasswordInput("");
      setPasswordDocId(null);
      setIsModalOpen(true);
    } else {
      toast.error("비밀번호가 일치하지 않습니다.");
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsPasswordModalOpen(false);
    setPasswordDocId(null);
    setPasswordInput("");
    setSelectedDoc(null);
  };

  const handlePresetClick = (preset) => {
    setCurrentPage(1);
    setFilters((prev) => ({
      ...prev,
      activePreset: preset,
      publicFilter: "all",
      importantFilter: "all",
      categoryFilter: "전체",
      modelFilter: "전체 모델",
      dateFilter: {
        type: preset === "all" ? "all" : "preset",
        preset: preset,
        range: { start: "", end: "" },
      },
    }));
  };

  const toggleDateRange = () => {
    setCurrentPage(1);
    setFilters((prev) => ({
      ...prev,
      activePreset:
        prev.dateFilter.type === "range" ? prev.activePreset : "all",
      dateFilter: {
        type: prev.dateFilter.type === "range" ? "all" : "range",
        preset: null,
        range: prev.dateFilter.range,
      },
    }));
  };

  const toggleCurrentPage = () => {
    const currentPageIds = currentItems
      .filter(canCheck)
      .map((item) => Number(item.id));
    setSelectedItems((prev) => {
      if (currentPageIds.every((id) => prev.includes(id)))
        return prev.filter((id) => !currentPageIds.includes(id));
      return Array.from(new Set([...prev, ...currentPageIds]));
    });
  };

  const toggleAllFiltered = () => {
    const allSelectableIds = filteredData
      .filter(canCheck)
      .map((item) => Number(item.id));
    setSelectedItems((prev) =>
      allSelectableIds.every((id) => prev.includes(id)) ? [] : allSelectableIds,
    );
  };

  const clearAllSelection = () => setSelectedItems([]);

  const requestSort = (key) => {
    if (!key) return;
    let direction = "asc";
    if (sortConfig.key === key)
      direction = sortConfig.direction === "asc" ? "desc" : "asc";
    else
      direction = ["id", "charCount", "datetime", "isImportant"].includes(key)
        ? "desc"
        : "asc";
    setSortConfig({ key, direction });
    setFilters((prev) => ({ ...prev, sortOption: "" }));
    setCurrentPage(1);
  };

  const handleDownload = async () => {
    if (selectedItems.length === 0)
      return toast.error("다운로드할 항목을 선택하세요.");
    const safeIds = selectedItems.filter((id) => !isNaN(id) && id > 0);
    const importantDocs = filteredData.filter(
      (item) => safeIds.includes(Number(item.id)) && item.isImportant,
    );
    const hasImportant = importantDocs.length > 0;

    if (
      hasImportant &&
      !window.confirm(
        `중요 문서 ${importantDocs.length}개 포함\nZIP으로 다운로드합니다.\n진행할까요?`,
      )
    )
      return;

    try {
      const res = await fetch(buildApiUrl("/api/documents/download-selected"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_ids: safeIds,
          user_id: currentUserId,
          format: hasImportant ? "zip" : "csv",
        }),
      });
      if (!res.ok) throw new Error("다운로드 실패");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = hasImportant
        ? `${currentUser}_보호된_요약목록.zip`
        : `${currentUser}_선택_요약목록.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(hasImportant ? "ZIP 다운로드 완료!" : "CSV 다운로드 완료!");
    } catch (err) {
      toast.error("다운로드 실패: " + err.message);
    }
  };

  return {
    currentUser,
    isAdmin,
    loading,
    error,
    data,
    filteredData,
    currentItems,
    selectedItems,
    selectedDoc,
    isModalOpen,
    passwordInput,
    isPasswordModalOpen,
    sortConfig,
    availableModels,
    itemsPerPage,
    currentPage,
    totalPages,
    filters,
    isMyDocument,
    canCheck,
    canView,
    handleCheckboxChange,
    handleViewClick,
    handlePasswordSubmit,
    closeModal,
    handlePresetClick,
    toggleDateRange,
    toggleCurrentPage,
    toggleAllFiltered,
    clearAllSelection,
    requestSort,
    handleDownload,
    setFilters,
    setCurrentPage,
    setItemsPerPage,
    setPasswordInput,
    setIsPasswordModalOpen,
  };
<<<<<<< HEAD
};
=======
};
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
