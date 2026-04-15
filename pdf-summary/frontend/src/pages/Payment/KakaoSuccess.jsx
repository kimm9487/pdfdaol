import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { buildApiUrl } from "../../config/api";

const KakaoSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const approve = async () => {
      const orderId = searchParams.get("order_id");
      const pgToken = searchParams.get("pg_token");
      const queryUserId = Number(searchParams.get("user_id")) || 0;
      const userId = queryUserId || Number(localStorage.getItem("userDbId")) || 0;
      const documentId = Number(searchParams.get("document_id")) || null;

      if (!orderId || !pgToken || !userId) {
        toast.error("결제 승인 파라미터가 올바르지 않습니다.");
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "kakaopay:error", detail: "결제 승인 파라미터가 올바르지 않습니다." },
            window.location.origin,
          );
          window.close();
          return;
        }
        navigate("/userlist", { replace: true });
        return;
      }

      try {
        const res = await fetch(buildApiUrl("/api/payments/kakao/approve"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: orderId,
            pg_token: pgToken,
            user_id: userId,
          }),
        });

        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.detail || "결제 승인 실패");
        }

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            {
              type: "kakaopay:approved",
              documentId: payload?.document_id ?? documentId,
              orderId,
            },
            window.location.origin,
          );
          window.close();
          return;
        }
        toast.success("결제가 완료되었습니다.");
      } catch (err) {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "kakaopay:error", detail: err.message || "결제 승인 중 오류가 발생했습니다." },
            window.location.origin,
          );
          window.close();
          return;
        }
        toast.error(err.message || "결제 승인 중 오류가 발생했습니다.");
      } finally {
        if (!window.opener || window.opener.closed) {
          navigate("/userlist", { replace: true });
        }
      }
    };

    approve();
  }, [navigate, searchParams]);

  return <div style={{ padding: "40px", textAlign: "center" }}>결제 승인 처리 중...</div>;
};

export default KakaoSuccess;
