
import { useState, useEffect, useCallback } from "react";
import { buildApiUrl } from "../config/api";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

export const useDocumentHistory = () => {
  const [userInfo, setUserInfo] = useState({
    username: "",
    full_name: localStorage.getItem("userName") || "사용자",
    email: "이메일 정보 없음",
    role: "user",
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUserData = useCallback(async () => {
    setLoading(true);
    try {
      const userDbId = localStorage.getItem("userDbId");
      if (!userDbId) {
        setLoading(false);
        return;
      }

      const profileResponse = await fetch(
        buildApiUrl(`/auth/profile/${userDbId}`),
        { cache: "no-store" },
      );
      let userRole = "user";
      if (profileResponse.ok) {
        const profileData = await profileResponse.json();
        setUserInfo(profileData);
        userRole = profileData.role;
      }

      const historyUrl =
        userRole === "admin"
          ? buildApiUrl("/api/admin/documents?limit=1000")
          : buildApiUrl(
              `/api/documents/users/${userDbId}/documents?limit=1000`,
            );

      const historyResponse = await fetch(historyUrl, { cache: "no-store" });
      if (historyResponse.ok) {
        const historyData = await historyResponse.json();
        if (historyData && Array.isArray(historyData.documents)) {
          const formattedHistory = historyData.documents.map((doc) => ({
            ...doc,
            date: doc.created_at ? doc.created_at.split("T")[0] : "",
            fileName: doc.filename,
            model: doc.model_used || doc.translation_model || "미선택",
            status:
              doc.summary &&
              String(doc.summary).trim() &&
              doc.summary !== "요약 내용이 없습니다."
                ? "완료"
                : "추출완료",
            is_public:
              String(doc.is_public) === "true" || String(doc.is_public) === "1",
            is_important:
              doc.is_important === true || String(doc.is_important) === "1",
          }));
          setHistory(formattedHistory);
        }
      }
    } catch (error) {
      console.error("데이터 로드 에러:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  const handleProfileUpdate = (updatedProfile) => {
    setUserInfo((prev) => ({ ...prev, ...updatedProfile }));
  };

  const fetchDocument = async (docId) => {
    try {
      const userDbId = localStorage.getItem("userDbId");
      const response = await fetch(
<<<<<<< HEAD
        buildApiUrl(`/api/documents/documents/${docId}?user_id=${userDbId}`),
=======
        buildApiUrl(`/api/document/${docId}?user_id=${userDbId}`),
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
        { method: "GET" },
      );
      if (response.ok) {
        return await response.json();
      } else {
        toast.error("문서를 불러올 수 없습니다.");
        return null;
      }
    } catch (error) {
      toast.error("문서를 불러올 수 없습니다.");
      return null;
    }
  };

  const saveSummary = async (updatedData) => {
    try {
      const userDbId = localStorage.getItem("userDbId");
      const response = await fetch(
        buildApiUrl(`/api/documents/documents/${updatedData.docId}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: parseInt(userDbId),
            filename: updatedData.fileName,
            extracted_text: updatedData.extractedText,
            summary: updatedData.summary,
            is_important: updatedData.isImportant,
            password: updatedData.password,
          }),
        },
      );
      if (response.ok) {
        setHistory((prev) =>
          prev.map((doc) =>
            doc.id === updatedData.docId
              ? {
                  ...doc,
                  fileName: updatedData.fileName,
                  summary: updatedData.summary,
                  is_important: updatedData.isImportant,
                }
              : doc,
          ),
        );
        toast.success("문서 정보가 성공적으로 수정되었습니다.");
        return true;
      } else {
        toast.error("문서 수정 실패");
        return false;
      }
    } catch (error) {
      toast.error("오류가 발생했습니다.");
      return false;
    }
  };

  const deleteDocument = async (docId, fileName) => {
    if (!window.confirm(`"${fileName}"을(를) 삭제하시겠습니까?`)) return false;
    try {
      const userDbId = localStorage.getItem("userDbId");
      const response = await fetch(
        buildApiUrl(`/api/documents/documents/${docId}`),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ user_id: String(userDbId) }).toString(),
        },
      );
      if (response.ok) {
        setHistory((prev) => prev.filter((doc) => doc.id !== docId));
        toast.success("문서가 삭제되었습니다.");
        return true;
      } else {
        toast.error("문서 삭제 실패");
        return false;
      }
    } catch (error) {
      toast.error("오류가 발생했습니다.");
      return false;
    }
  };

  // [추가 2026-03-19] 170~196줄: 일괄 삭제 함수 - 선택된 id 배열을 병렬로 DELETE 요청
  const deleteBulk = async (ids) => {
    if (!ids.length) return 0;
    const userDbId = localStorage.getItem("userDbId");
    let successCount = 0;
    await Promise.all(
      ids.map(async (docId) => {
        try {
          const res = await fetch(
            buildApiUrl(`/api/documents/documents/${docId}`),
            {
              method: "DELETE",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                user_id: String(userDbId),
              }).toString(),
            },
          );
          if (res.ok) successCount++;
        } catch (_) {}
      }),
    );
    if (successCount > 0) {
      setHistory((prev) => prev.filter((doc) => !ids.includes(doc.id)));
      toast.success(`${successCount}개 문서가 삭제되었습니다.`);
    }
    return successCount;
  };

  const togglePublic = async (item) => {
    const newPublicStatus = !item.is_public;
    const userDbId = localStorage.getItem("userDbId");
    try {
      const response = await fetch(
        buildApiUrl(`/api/documents/documents/${item.id}/public`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: parseInt(userDbId),
            is_public: newPublicStatus,
          }),
        },
      );
      if (response.ok) {
        setHistory((prev) =>
          prev.map((doc) =>
            doc.id === item.id ? { ...doc, is_public: newPublicStatus } : doc,
          ),
        );
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  };

  const deleteAccount = async () => {
    if (
      window.confirm("정말로 탈퇴하시겠습니까? 모든 히스토리가 삭제됩니다.")
    ) {
      try {
        const userId = localStorage.getItem("userId");
        const response = await fetch(buildApiUrl(`/auth/withdraw/${userId}`), {
          method: "DELETE",
        });
        if (response.ok) {
          toast.success("회원 탈퇴가 완료되었습니다.");
          localStorage.clear();
          window.location.href = "/";
        } else {
          toast.error("탈퇴 처리 중 오류가 발생했습니다.");
        }
      } catch (error) {}
    }
  };

  return {
    userInfo,
    history,
    loading,
    handleProfileUpdate,
    fetchDocument,
    saveSummary,
    deleteDocument,
    deleteBulk, // [추가 2026-03-19] 248줄: 일괄 삭제 함수 export
    togglePublic,
    deleteAccount,
    setHistory, // Exposing setHistory for direct manipulation if needed
  };
};
