import React from "react";

const UserProfileCard = ({
  userInfo,
  historyLength,
  onEditClick,
  onDeleteAccount,
}) => {
  return (
    <aside className="profile-card">
      <div className="profile-image">{userInfo.full_name[0]}</div>
      <h2 className="user-name">{userInfo.full_name}님</h2>
      <p className="user-id">@{userInfo.username}</p>
      <p className="user-email">{userInfo.email}</p>
      {userInfo.role === "admin" && (
        <p className="user-role" style={{ color: "red", fontWeight: "bold" }}>
          👨‍💼 관리자
        </p>
      )}
      <hr />
      <div className="stats">
        <div className="stat-item">
          <span className="stat-label">총 요약 건수</span>
          <span className="stat-value">{historyLength}건</span>
        </div>
      </div>
      <button className="edit-btn" onClick={onEditClick}>
        프로필 수정
      </button>
      <button className="delete-account-btn" onClick={onDeleteAccount}>
        회원 탈퇴
      </button>
    </aside>
  );
};

export default UserProfileCard;
