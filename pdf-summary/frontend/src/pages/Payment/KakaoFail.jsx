import { useMemo } from "react";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const KakaoFail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const reason = useMemo(() => searchParams.get("reason") || "unknown", [searchParams]);

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "kakaopay:failed", reason },
        window.location.origin,
      );
      window.close();
    }
  }, [reason]);

  return (
    <div style={{ padding: "40px", textAlign: "center" }}>
      <h2>결제가 완료되지 않았습니다.</h2>
      <p>사유: {reason}</p>
      <button onClick={() => navigate("/userlist")}>목록으로 이동</button>
    </div>
  );
};

export default KakaoFail;
