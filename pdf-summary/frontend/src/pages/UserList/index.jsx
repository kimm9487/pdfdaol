// src/pages/UserList/index.jsx
import React from "react";
import { useUserList } from "../../hooks/useUserList";
import StatsBoard from "./StatsBoard";
import FilterSection from "./FilterSection";
import SelectionControls from "./SelectionControls";
import UserTable from "./UserTable";
import PaginationArea from "./PaginationArea";
import Modals from "./Modals";
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용
import "./style.css"; // 기존 CSS 파일 사용

const UserList = () => {
  const state = useUserList();

  if (state.loading)
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        데이터 로딩 중...
      </div>
    );
  if (state.error)
    return (
      <div style={{ padding: "40px", color: "red" }}>오류: {state.error}</div>
    );

  return (
    <div className="summary-list-page">
      <div className="title-wrapper">
        <div className="title-bar"></div>
        <h2>요약 목록</h2>
      </div>

      <div className="description-wrapper">
        <div className="description-box">
          📝 전체 사용자의 요약 이력을 조회할 수 있습니다. (본인 포함 전체 공개)
        </div>
      </div>

      <StatsBoard {...state} />
      <FilterSection {...state} />
      <SelectionControls {...state} />
      <UserTable {...state} />
      <PaginationArea {...state} />
      <Modals {...state} />

      {/* 하단 안내 그리드 */}
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

<<<<<<< HEAD
export default UserList;
=======
export default UserList;
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
