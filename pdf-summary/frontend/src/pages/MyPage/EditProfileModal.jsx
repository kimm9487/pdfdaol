import React, { useState } from "react";
import { buildApiUrl } from "../../config/api";

const EditProfileModal = ({ show, onClose, userInfo, onProfileUpdate }) => {
  const [editPassword, setEditPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [editLoading, setEditLoading] = useState(false);

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

      if (editPassword) formData.append("new_password", editPassword);
      formData.append("current_password", currentPassword);

      const response = await fetch(buildApiUrl(`/auth/profile/${userDbId}`), {
        method: "PUT",
        body: formData,
      });

      if (response.ok) {
        const updatedProfile = await response.json();
        onProfileUpdate(updatedProfile); // Notify parent component
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

  const handleClose = () => {
    setCurrentPassword("");
    setEditPassword("");
    onClose();
  };

  if (!show) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>프로필 수정</h2>
        <div className="modal-body">
          <div className="form-group">
            <label>현재 이메일</label>
            <input type="text" value={userInfo.email} disabled />
          </div>

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
