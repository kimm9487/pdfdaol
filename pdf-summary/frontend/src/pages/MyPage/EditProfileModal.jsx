import React, { useState, useEffect } from "react";
import { buildApiUrl } from "../../config/api";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

const EditProfileModal = ({ show, onClose, userInfo, onProfileUpdate }) => {
  const [editEmail, setEditEmail] = useState(userInfo.email);
  const [editPassword, setEditPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const [emailCode, setEmailCode] = useState("");
  const [isEmailCodeSent, setIsEmailCodeSent] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [emailTimeLeft, setEmailTimeLeft] = useState(300);

  // 소셜 계정 여부 확인 (local이 아니면 소셜 계정으로 간주)
  const isSocialAccount = userInfo?.provider && userInfo.provider.toLowerCase() !== "local";
  useEffect(() => {
    if (show) {
      console.log("현재 모달이 받은 userInfo 정보:", userInfo);
    }
  }, [show, userInfo]);
  useEffect(() => {
    let timer;
    if (isEmailCodeSent && !isEmailVerified && emailTimeLeft > 0) {
      timer = setInterval(() => setEmailTimeLeft((prev) => prev - 1), 1000);
    } else if (emailTimeLeft === 0) {
      setIsEmailCodeSent(false);
      alert("인증 시간이 만료되었습니다. 다시 요청해주세요.");
    }
    return () => clearInterval(timer);
  }, [isEmailCodeSent, isEmailVerified, emailTimeLeft]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleSendEmailCode = async () => {
    if (isSocialAccount) return; // 소셜 계정은 실행 방지
    if (!editEmail) {
      alert("새 이메일을 입력해주세요.");
      return;
    }
    try {
      const form = new FormData();
      form.append("new_email", editEmail);

      const response = await fetch(
        buildApiUrl("/auth/send-email-change-code"),
        {
          method: "POST",
          body: form,
        },
      );
      const data = await response.json();

      if (response.ok) {
        setIsEmailCodeSent(true);
        setEmailTimeLeft(300);
        alert(data.message);
      } else {
        alert(data.detail || "메일 발송 실패");
      }
    } catch (err) {
      alert("서버 오류가 발생했습니다.");
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!emailCode) {
      alert("인증번호를 입력해주세요.");
      return;
    }
    try {
      const form = new FormData();
      form.append("new_email", editEmail);
      form.append("code", emailCode);

      const response = await fetch(
        buildApiUrl("/auth/verify-email-change-code"),
        {
          method: "POST",
          body: form,
        },
      );
      const data = await response.json();

      if (response.ok) {
        setIsEmailVerified(true);
        setIsEmailCodeSent(false);
        alert(data.message);
      } else {
        alert(data.detail || "인증 실패");
      }
    } catch (err) {
      alert("서버 오류가 발생했습니다.");
    }
  };

  const handleEditProfile = async () => {
    if (!currentPassword) {
      alert("현재 비밀번호를 입력해주세요.");
      return;
    }
    if (editPassword && editPassword.length < 6) {
      alert("새 비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    const isEmailChanged = editEmail && editEmail !== userInfo.email;
    
    // 소셜 계정이 아닌 경우에만 이메일 인증 체크
    if (!isSocialAccount && isEmailChanged && !isEmailVerified) {
      alert("새 이메일 인증을 완료해주세요.");
      return;
    }

    setEditLoading(true);

    try {
      const userDbId = localStorage.getItem("userDbId");
      const formData = new FormData();

      // 소셜 계정이 아닐 때만 수정한 이메일 전송
      if (!isSocialAccount && isEmailChanged) formData.append("email", editEmail);
      
      if (editPassword) formData.append("new_password", editPassword);
      formData.append("current_password", currentPassword);

      const response = await fetch(buildApiUrl(`/auth/profile/${userDbId}`), {
        method: "PUT",
        body: formData,
      });

      if (response.ok) {
        const updatedProfile = await response.json();
        onProfileUpdate(updatedProfile);
        alert("프로필이 성공적으로 수정되었습니다.");
        handleClose();
      } else {
        const error = await response.json();
        alert(error.detail || "프로필 수정 실패");
      }
    } catch (error) {
      alert("프로필 수정 중 오류가 발생했습니다.");
    } finally {
      setEditLoading(false);
    }
  };

  const handleEmailChange = (e) => {
    if (isSocialAccount) return;
    setEditEmail(e.target.value);
    setIsEmailCodeSent(false);
    setIsEmailVerified(false);
    setEmailCode("");
  };

  const handleClose = () => {
    setEditEmail(userInfo.email);
    setCurrentPassword("");
    setEditPassword("");
    setIsEmailCodeSent(false);
    setIsEmailVerified(false);
    setEmailCode("");
    onClose();
  };

  if (!show) {
    return null;
  }

  const isEmailChanged = editEmail && editEmail !== userInfo.email;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>프로필 수정</h2>
        <div className="modal-body">
          <div className="form-group">
            <label>현재 이메일</label>
            <input type="text" value={userInfo.email} disabled />
          </div>

          <div className="form-group">
            <label>새 이메일 (선택)</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="email"
                value={editEmail}
                onChange={handleEmailChange}
                placeholder={isSocialAccount ? "" : "변경할 이메일을 입력하세요"}
                // 인증 완료되었거나 '소셜 계정'인 경우 비활성화
                disabled={isEmailVerified || isSocialAccount}
                style={{ backgroundColor: isSocialAccount ? "#f5f5f5" : "white" }}
              />
              {/* 소셜 계정이 아닐 때만 인증 버튼 노출 */}
              {!isSocialAccount && isEmailChanged && (
                <button
                  type="button"
                  className={`btn-small ${isEmailVerified ? "btn-success" : ""}`}
                  onClick={handleSendEmailCode}
                  disabled={
                    isEmailVerified || (isEmailCodeSent && emailTimeLeft > 0)
                  }
                >
                  {isEmailVerified
                    ? "인증완료"
                    : isEmailCodeSent
                      ? "재전송"
                      : "인증요청"}
                </button>
              )}
            </div>
            {/* 소셜 계정 안내 문구 추가 */}
            {isSocialAccount && (
              <p style={{ color: "#e74c3c", fontSize: "12px", marginTop: "8px", fontWeight: "500" }}>
                소셜계정은 이메일을 수정할 수 없습니다.
              </p>
            )}
          </div>

          {/* 이하 생략 (인증번호 입력 및 비밀번호 필드 등 기존과 동일) */}
          {isEmailChanged && isEmailCodeSent && !isEmailVerified && !isSocialAccount && (
            <div
              className="form-group"
              style={{
                backgroundColor: "#f8f9fa",
                padding: "10px",
                borderRadius: "6px",
              }}
            >
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="인증번호 6자리"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-small"
                  style={{ backgroundColor: "#4a90e2", color: "white" }}
                  onClick={handleVerifyEmailCode}
                >
                  확인
                </button>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "#e74c3c",
                  marginTop: "8px",
                  textAlign: "right",
                  fontWeight: "bold",
                }}
              >
                남은 시간 : <span>{formatTime(emailTimeLeft)}</span>
              </p>
            </div>
          )}

          <div className="form-group" style={{ marginTop: "15px" }}>
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
            onClick={handleClose}
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
  );
};

export default EditProfileModal;