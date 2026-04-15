import { useEffect, useRef, useState } from "react";
import ChatHeader from "./WebSocketChatHeader";
import MessageList from "./WebSocketMessageList";
import ChatInput from "./WebSocketChatInput";

// 탭 목록 정의 (key, label, 아이콘 타입)
const CHAT_TABS = [
  { key: "users", label: "유저", icon: "users" },
  { key: "chat", label: "채팅", icon: "chat" },
  { key: "dm", label: "귓속말", icon: "dm" },
];

// 탭 아이콘 SVG 컴포넌트 (users / dm / chat)
function TabIcon({ type }) {
  if (type === "users") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1a4 4 0 0 0-3-3.87M14 4.13a3 3 0 0 1 0 5.82"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "dm") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 9h8M8 13h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── 아바타 색상 및 밤 안내 문구 유틸 ────────────────────────────────
const USER_AVATAR_COLOR = "#7f93b2";
const ADMIN_AVATAR_COLOR = "#f59e0b";

const getAvatarColor = (isAdmin) => {
  return isAdmin ? ADMIN_AVATAR_COLOR : USER_AVATAR_COLOR;
};

const formatBanLabel = (entry) => {
  if (entry?.isPermanent || Number(entry?.banSeconds) === -1) {
    return "영구 정지";
  }

  const ttlSeconds = Number(entry?.ttlSeconds || 0);
  const banSeconds = Number(entry?.banSeconds || 0);
  const seconds = ttlSeconds > 0 ? ttlSeconds : banSeconds;
  if (seconds >= 86400) return `${Math.ceil(seconds / 86400)}일 남음`;
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}시간 남음`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}분 남음`;
  if (seconds > 0) return `${seconds}초 남음`;
  return "차단 중";
};

const getBanNoticeTitle = (banInfo) => {
  if (!banInfo) return "채팅이 제한되었습니다";
  if (banInfo.isPermanent) return "채팅이 영구 정지되었습니다";
  if (Number(banInfo.banSeconds || 0) > 0 || Number(banInfo.ttlSeconds || 0) > 0) {
    return "1일간 채팅이 금지되었습니다";
  }
  return "채팅방에서 강제 퇴장되었습니다";
};

const getBanNoticeDescription = (banInfo) => {
  if (!banInfo) return "관리자 해제 전까지 동일한 안내가 표시됩니다.";
  if (banInfo.isPermanent) {
    return "재접속해도 동일한 안내가 표시됩니다. 해제가 필요하면 관리자에게 문의해 주세요.";
  }
  if (Number(banInfo.banSeconds || 0) > 0 || Number(banInfo.ttlSeconds || 0) > 0) {
    return "제한 시간이 끝나기 전에는 재접속해도 채팅이 제한됩니다. 필요하면 관리자에게 문의해 주세요.";
  }
  return "강제 퇴장되었습니다. 채팅창을 다시 열면 재접속할 수 있습니다.";
};

const getModerationTone = (banSeconds) => {
  if (Number(banSeconds) === -1) return "critical";
  if (Number(banSeconds) > 0) return "severe";
  return "moderate";
};

const isAdminUser = (user, myUserId = "", myRole = "") => {
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin") return true;

  const uid = String(user?.userId || user?.id || "");
  return myRole === "admin" && uid && uid === myUserId;
};

// ─── WebSocketChatWindow 컴포넌트 ───────────────────────────────────
// 채팅·유저·DM 3탭 UI 컨테이너. 상태·로직은 모두 props로 주입받는다.
export default function WebSocketChatWindow({
  messages = [],
  dmMessages = [],
  onSend,
  onSendDm,
  onOpenDm,
  isConnected = false,
  onlineUsers = [],
  activeDmUserId = null,
  chatUnreadCount = 0,
  dmUnreadByUser = {},
  dmUnreadTotal = 0,
  dmThreadUserIds = [],
  dmLastByUser = {},
  dmUserNamesById = {},
  connectionError = null,
  isOpen = false,
  typingUsers = [],
  dmTypingUsers = [],
  onTypingChange,
  onDmTypingChange,
  onDeleteDmThread,
  onKickUser,
  onUnbanUser,
  onGetBannedUsers,
  banInfo = null,
  bannedUsers = [],
  onCloseDmRoom,
  onDmViewStateChange,
  onChatViewStateChange,
  onClose,
}) {
  // ─── 내부 UI 상태 ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("chat");
  const [userSearch, setUserSearch] = useState("");
  const [dmSearch, setDmSearch] = useState("");
  const [pendingDeleteRow, setPendingDeleteRow] = useState(null);
  const [pendingKickUser, setPendingKickUser] = useState(null);
  const [selectedKickUserIds, setSelectedKickUserIds] = useState([]);
  const [kickReason, setKickReason] = useState("욕설/비방");
  const [kickBanSeconds, setKickBanSeconds] = useState(0);
  const prevActiveTabRef = useRef("chat");

  // ─── 현재 사용자 ID·역할·권한 파생값 ─────────────────────────────
  const myUserId = String(
    localStorage.getItem("userDbId") || localStorage.getItem("userId") || "",
  );
  const myOnlineRole = String(
    (
      onlineUsers.find(
        (u) => String(u.userId || u.id || "") === myUserId,
      ) || {}
    ).role || "",
  ).toLowerCase();
  const myRole = String(localStorage.getItem("userRole") || myOnlineRole || "").toLowerCase();
  const canModerate = myRole === "admin" || myOnlineRole === "admin";
  const isKickPopup = Boolean(
    !banInfo &&
      connectionError &&
      (String(connectionError).includes("강제 퇴장") ||
        String(connectionError).includes("재로그인이 필요")),
  );
  const effectiveActiveTab = banInfo?.isPermanent || isKickPopup ? "chat" : activeTab;

  // ESC 키로 팝업 닫기
  useEffect(() => {
    if (!pendingDeleteRow && !pendingKickUser) return;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setPendingDeleteRow(null);
        setPendingKickUser(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [pendingDeleteRow, pendingKickUser]);

  // 유저 탭 활성 시 밤 목록 자동 조회 (관리자만)
  useEffect(() => {
    if (!canModerate || activeTab !== "users" || !onGetBannedUsers) return;
    onGetBannedUsers();
  }, [activeTab, canModerate, onGetBannedUsers]);

  // DM 룸 열기 + DM 탭으로 전환
  const openDm = (uid) => {
    if (!uid) return;
    if (onOpenDm) onOpenDm(uid);
    setActiveTab("dm");
  };

  // ─── 자동 스크롤 ref ────────────────────────────────────────────
  const bottomRef = useRef(null);
  const dmBottomRef = useRef(null);

  // ─── 유저 이름·역할 맵 (onlineUsers 기반) ──────────────────────────
  const userNameById = Object.fromEntries(
    onlineUsers.map((user) => [
      String(user.userId || user.id || ""),
      user.name || "",
    ]),
  );

  const userRoleById = Object.fromEntries(
    onlineUsers.map((user) => [
      String(user.userId || user.id || ""),
      String(user.role || "user").toLowerCase(),
    ]),
  );

  // ─── 메시지에 발신자 이름·역할 보강 ───────────────────────────────
  const decoratedMessages = messages.map((message) => ({
    ...message,
    senderName:
      userNameById[String(message.senderId)] || message.senderName || "",
    senderRole:
      userRoleById[String(message.senderId)] ||
      (String(message.senderId) === myUserId ? myRole || "user" : message.senderRole || "user"),
  }));

  const decoratedDmMessages = dmMessages.map((message) => ({
    ...message,
    senderName:
      userNameById[String(message.senderId)] || message.senderName || "",
    senderRole:
      userRoleById[String(message.senderId)] ||
      (String(message.senderId) === myUserId ? myRole || "user" : message.senderRole || "user"),
  }));

  // ─── 자동 스크롤 effects ──────────────────────────────────────────
  useEffect(() => {
    if (bottomRef.current && isOpen && effectiveActiveTab === "chat") {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, effectiveActiveTab]);

  useEffect(() => {
    if (dmBottomRef.current && isOpen && effectiveActiveTab === "dm") {
      dmBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [dmMessages, isOpen, effectiveActiveTab]);

  // ─── 탭·뷰 상태 변경 effects ─────────────────────────────────────────
  useEffect(() => {
    if (!onDmViewStateChange) return;
    const isViewingRoom = effectiveActiveTab === "dm" && Boolean(activeDmUserId);
    onDmViewStateChange(isViewingRoom);
  }, [effectiveActiveTab, activeDmUserId, onDmViewStateChange]);

  useEffect(() => {
    if (!onChatViewStateChange) return;
    onChatViewStateChange(effectiveActiveTab === "chat");
  }, [effectiveActiveTab, onChatViewStateChange]);

  // DM 탭에서 다른 탭으로 전환 시 DM 룸 자동 종료
  useEffect(() => {
    const prevTab = prevActiveTabRef.current;
    if (prevTab === "dm" && activeTab !== "dm" && activeDmUserId && onCloseDmRoom) {
      onCloseDmRoom();
    }
    prevActiveTabRef.current = activeTab;
  }, [activeTab, activeDmUserId, onCloseDmRoom]);

  // ─── UI 내부 메시지 전송 핸들러 ─────────────────────────────────────
  const handleSendMessage = (text) => {
    if (!text?.trim()) return false;
    return onSend(text);
  };

  const handleSendDmMessage = (text) => {
    if (!text?.trim() || !activeDmUserId || !onSendDm) return false;
    return onSendDm(activeDmUserId, text);
  };

  // ─── 입력 중 표시 텍스트 파생 ──────────────────────────────────────
  const typingText = (() => {
    if (!typingUsers.length) return "";
    if (typingUsers.length === 1) {
      const first = typingUsers[0].name || typingUsers[0].userId;
      return `${first} 입력중입니다`;
    }
    const first = typingUsers[0].name || typingUsers[0].userId;
    return `${first} 외 ${typingUsers.length - 1}명 입력중입니다`;
  })();

  const dmTypingText = (() => {
    if (!dmTypingUsers.length) return "";
    if (dmTypingUsers.length === 1) {
      const first = dmTypingUsers[0].name || dmTypingUsers[0].userId;
      return `${first} 입력중입니다`;
    }
    const first = dmTypingUsers[0].name || dmTypingUsers[0].userId;
    return `${first} 외 ${dmTypingUsers.length - 1}명 입력중입니다`;
  })();

  // ─── 밤·강퇴 상태 파생값 ──────────────────────────────────────────────
  const isTimedChatBan = Boolean(
    banInfo &&
      !banInfo.isPermanent &&
      (Number(banInfo.ttlSeconds || 0) > 0 || Number(banInfo.banSeconds || 0) > 0),
  );
  const isPermanentChatBan = Boolean(banInfo?.isPermanent);
  const isTabSwitchLocked = isPermanentChatBan;
  const kickReasonMatch = String(connectionError || "").match(/사유:\s*(.+?)(?:\n|$)/);
  const kickReasonText = kickReasonMatch?.[1]?.trim() || "관리자 조치";
  const isReconnectWaiting = Boolean(
    !banInfo &&
      connectionError &&
      (String(connectionError).includes("잠시만 기다") ||
        String(connectionError).includes("연결 중") ||
        String(connectionError).includes("재연결") ||
        String(connectionError).includes("자동으로 다시 연결")),
  );

  // ─── 유저 목록 필터 및 관리자 처리 관련 파생값 ────────────────────────
  const filteredUsers = (() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return onlineUsers;
    return onlineUsers.filter((u) => {
      const name = String(u.name || "").toLowerCase();
      const uid = String(u.userId || u.id || "").toLowerCase();
      return name.includes(q) || uid.includes(q);
    });
  })();

  const moderationCandidates = filteredUsers.filter((u) => {
    const uid = String(u.userId || u.id || "");
    return uid && uid !== myUserId;
  });

  const allSelected =
    moderationCandidates.length > 0 &&
    selectedKickUserIds.length === moderationCandidates.length;

  const toggleKickTarget = (targetId) => {
    const normalized = String(targetId || "");
    if (!normalized || normalized === myUserId) return;

    setSelectedKickUserIds((prev) =>
      prev.includes(normalized)
        ? prev.filter((id) => id !== normalized)
        : [...prev, normalized],
    );
  };

  const toggleSelectAllKickTargets = () => {
    if (allSelected) {
      setSelectedKickUserIds([]);
      return;
    }
    setSelectedKickUserIds(
      moderationCandidates
        .map((u) => String(u.userId || u.id || ""))
        .filter(Boolean),
    );
  };

  // 타임스탬프를 HH:MM 형식으로 변환
  const toTimeLabel = (timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "방금";
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  // ─── DM 목록 행 목록 계산 (정렬·필터·unread 포함) ───────────────────
  const dmPreviewRows = (() => {
    const candidateIds = [
      ...dmThreadUserIds,
      String(activeDmUserId || ""),
      ...Object.keys(dmUnreadByUser),
      ...Object.keys(dmLastByUser),
    ]
      .filter((id) => id)
      .filter((id, idx, arr) => arr.indexOf(id) === idx);

    const baseRows = candidateIds
      .map((uid, idx) => {
        const latest = dmLastByUser[uid] || null;
        const unread = Number(dmUnreadByUser[uid] || 0);
        const isActive = String(activeDmUserId || "") === String(uid);
        const isThreadSeed = dmThreadUserIds.includes(String(uid));
        const preview = String(latest?.preview || "").trim();

        // F5 직후 last preview 복원 지연이 있어도 스레드 목록은 유지한다.
        if (!preview && unread <= 0 && !isActive && !isThreadSeed) {
          return null;
        }

        return {
          id: uid || `dm-${idx}`,
          name:
            userNameById[uid] ||
            dmUserNamesById[uid] ||
            latest?.senderName ||
            String(uid),
          preview,
          time: latest?.timestamp ? toTimeLabel(latest.timestamp) : "",
          unread,
          sortTs: latest?.timestamp ? new Date(latest.timestamp).getTime() : 0,
        };
      })
      .filter(Boolean);

    baseRows.sort((a, b) => b.sortTs - a.sortTs);

    const q = dmSearch.trim().toLowerCase();
    if (!q) return baseRows;
    return baseRows.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.preview.toLowerCase().includes(q),
    );
  })();

  // DM 입력 필드 타이핑 이벤트 전달
  const handleDmTypingInputChange = (value) => {
    if (!activeDmUserId || !onDmTypingChange) return;
    onDmTypingChange(activeDmUserId, value);
  };

  return (
    <div className="chat-window-shell">
      {/* 채팅 헤더: 연결 상태·온라인 수·닫기 버튼 */}
      <ChatHeader
        isConnected={isConnected}
        onlineCount={onlineUsers.length}
        activeTab={effectiveActiveTab}
        onClose={onClose}
      />

      {effectiveActiveTab === "users" && (
        <div className="chat-section users-section">
          <div className="chat-search-bar">
            <div className="chat-search-inner">
              <span>🔎</span>
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="이름, ID 검색..."
                aria-label="유저 검색"
              />
            </div>
          </div>

          <div className="user-filter-tabs">
            <div className="user-filter-tab active">
              전체 <span className="user-filter-tab__count">{onlineUsers.length}</span>
            </div>
            <div className="user-filter-tab">
              온라인 <span className="user-filter-tab__count">{onlineUsers.length}</span>
            </div>
            <div className="user-filter-tab">
              자리비움 <span className="user-filter-tab__count">0</span>
            </div>
            <div className="user-filter-tab">
              오프라인 <span className="user-filter-tab__count">0</span>
            </div>
          </div>

          {canModerate && moderationCandidates.length > 0 && (
            <div className="user-bulk-actions-bar">
              <label className="user-bulk-actions-bar__check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAllKickTargets}
                />
                전체 선택
              </label>

              <span className="user-bulk-actions-bar__count">선택 {selectedKickUserIds.length}명</span>

              <button
                type="button"
                className="user-bulk-actions-bar__kick-btn"
                disabled={selectedKickUserIds.length === 0}
                onClick={() => {
                  if (selectedKickUserIds.length === 0) return;
                  setKickReason("욕설/비방");
                  setKickBanSeconds(0);
                  setPendingKickUser({
                    id: "bulk",
                    name: `${selectedKickUserIds.length}명`,
                    targetIds: [...selectedKickUserIds],
                    isBulk: true,
                  });
                }}
              >
                선택 강퇴
              </button>
            </div>
          )}

          <div className="section-scroll">
            <div className="user-team-header">
              <div className="user-team-header__name-wrap">
                <span className="user-team-header__bar" />
                <span className="user-team-header__name">실시간 참여자</span>
              </div>
              <span className="user-team-header__count">{filteredUsers.length}명</span>
            </div>

            {filteredUsers.map((u, i) => {
              const uid = u.userId || u.id || "";
              const name = u.name || `User ${uid}`;
              const isAdmin = isAdminUser(u, myUserId, myRole);
              const initials = name.slice(0, 1).toUpperCase();
              const color = getAvatarColor(isAdmin);
              const isSelectedKickTarget = selectedKickUserIds.includes(String(uid));

              return (
                <div className={`user-row ${isAdmin ? "admin" : ""}`} key={uid || i}>
                  {canModerate && String(uid) !== myUserId && (
                    <label className="user-row__select" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelectedKickTarget}
                        onChange={() => toggleKickTarget(uid)}
                        aria-label={`${name} 선택`}
                      />
                    </label>
                  )}

                  <div className="user-avatar">
                    <div className="user-avatar__circle" style={{ background: color }}>
                      {initials}
                    </div>
                    <span className="user-avatar__status online" />
                  </div>

                  <div className="user-row__info">
                    <div className="user-row__name-row">
                      <span className="user-row__name">{name}</span>
                      {isAdmin && <span className="user-row__role">관리자</span>}
                      {isAdmin && <span className="user-row__admin-tag">ADMIN</span>}
                    </div>
                    <div className="user-row__activity online">채팅 가능</div>
                  </div>

                  <button
                    type="button"
                    className="user-row__dm-btn"
                    aria-label={`${name} 1대1 시작`}
                    onClick={() => openDm(uid)}
                  >
                    💬
                  </button>
                </div>
              );
            })}
          </div>

          {canModerate && (
            <div className="ban-list-section">
              <div className="ban-list-section__header">
                <span className="ban-list-section__title">채팅 차단 목록</span>
                <button
                  type="button"
                  className="ban-list-section__refresh"
                  onClick={() => {
                    if (onGetBannedUsers) onGetBannedUsers();
                  }}
                  title="목록 새로고침"
                >
                  ↻
                </button>
              </div>
              {bannedUsers.length === 0 ? (
                <div className="ban-list-empty">차단된 사용자 없음</div>
              ) : (
                bannedUsers.map((b) => (
                  <div key={b.targetUserId} className="ban-list-row">
                    <div className="ban-list-row__info">
                      <span className="ban-list-row__name">{b.targetName || b.targetUserId}</span>
                      <span className="ban-list-row__reason">{b.reason}</span>
                      <span className="ban-list-row__ttl">{formatBanLabel(b)}</span>
                    </div>
                    <button
                      type="button"
                      className="ban-list-row__unban"
                      onClick={() => {
                        if (onUnbanUser) onUnbanUser(b.targetUserId);
                      }}
                    >
                      해제
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 채팅 탭: 강퇴/뱈 안내 또는 일반 채팅 뷰 ─── */}
      {effectiveActiveTab === "chat" && (
        <div className="chat-section chat-section-live">
          {isKickPopup ? (
            <div className="chat-ban-notice">
              <div className="chat-ban-notice__icon">⚠️</div>
              <div className="chat-ban-notice__title">채팅방에서 강제 퇴장되었습니다</div>
              <div className="chat-ban-notice__reason">사유: {kickReasonText}</div>
              <div className="chat-ban-notice__desc">
                재로그인이 필요합니다. 로그인 후 채팅을 다시 열어 접속해 주세요.
              </div>
              <div className="chat-ban-notice__time">조치: 강제 퇴장</div>
              <button
                type="button"
                className="chat-ban-notice__close"
                onClick={() => {
                  if (onClose) onClose();
                }}
              >
                확인
              </button>
            </div>
          ) : isPermanentChatBan ? (
            <div className="chat-ban-notice">
              <div className="chat-ban-notice__icon">🚫</div>
              <div className="chat-ban-notice__title">{getBanNoticeTitle(banInfo)}</div>
              <div className="chat-ban-notice__reason">사유: {banInfo.reason}</div>
              <div className="chat-ban-notice__desc">
                {getBanNoticeDescription(banInfo)}
              </div>
              {banInfo.isPermanent ? (
                <div className="chat-ban-notice__time">조치: 영구 정지</div>
              ) : banInfo.ttlSeconds > 0 ? (
                <div className="chat-ban-notice__time">남은 시간: 약 {Math.ceil(banInfo.ttlSeconds / 60)}분</div>
              ) : banInfo.banSeconds > 0 ? (
                <div className="chat-ban-notice__time">
                  채팅 금지: {banInfo.banSeconds >= 86400
                    ? `${Math.floor(banInfo.banSeconds / 86400)}일`
                    : banInfo.banSeconds >= 3600
                    ? `${Math.floor(banInfo.banSeconds / 3600)}시간`
                    : `${Math.floor(banInfo.banSeconds / 60)}분`}
                </div>
              ) : null}
              <div className="chat-ban-notice__by">처리자: {banInfo.byName}</div>
              <button
                type="button"
                className="chat-ban-notice__close"
                onClick={() => {
                  if (onClose) onClose();
                }}
              >
                확인
              </button>
            </div>
          ) : (
            <>
              <div className="chat-avatar-strip">
                {onlineUsers.map((u, i) => {
                  const uid = u.userId || u.id || "";
                  const isAdmin = isAdminUser(u, myUserId, myRole);
                  const initials = (u.name || String(uid)).slice(0, 1).toUpperCase();
                  const color = getAvatarColor(isAdmin);

                  return (
                    <div
                      key={uid || i}
                      className={`chat-avatar-strip__item ${isAdmin ? "admin" : ""}`}
                      title={u.name || String(uid)}
                    >
                      <div className="chat-avatar-strip__circle" style={{ background: color }}>
                        {initials}
                      </div>
                      <span className="chat-avatar-strip__dot" />
                      {isAdmin && <span className="chat-avatar-strip__crown" aria-hidden="true">👑</span>}
                    </div>
                  );
                })}
                <span className="chat-avatar-strip__conn">{isConnected ? "연결됨" : "재연결 중"}</span>
              </div>

              <div className="chat-live-view">
                <MessageList messages={decoratedMessages} bottomRef={bottomRef} />
              </div>

              {typingUsers.length > 0 && (
                <div className="chat-typing-indicator is-visible" aria-live="polite">
                  <div className="chat-typing-dots" aria-hidden="true">
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                  </div>
                  <span className="chat-typing-label">{typingText}</span>
                </div>
              )}

              <div className="chat-input-zone">
                <ChatInput
                  onSend={handleSendMessage}
                  disabled={!isConnected || isTimedChatBan}
                  onTypingChange={onTypingChange}
                />
              </div>

              {connectionError && !isKickPopup && (
                <div
                  className={`chat-conn-error ${isReconnectWaiting ? "is-waiting" : ""}`}
                  role="alert"
                  aria-live="polite"
                >
                  {connectionError}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── DM 탭: 1대 nextProps 대화 목록 또는 룸 뷰 ─── */}
      {effectiveActiveTab === "dm" && (
        <div className="chat-section dm-section">
          {activeDmUserId ? (
            <>
              <div className="dm-room-header">
                <button
                  type="button"
                  className="dm-room-header__back"
                  onClick={onCloseDmRoom}
                  aria-label="1대1 목록으로 돌아가기"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      d="M15 6l-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="dm-room-header__title">
                  {userNameById[String(activeDmUserId)] ||
                    dmUserNamesById[String(activeDmUserId)] ||
                    dmLastByUser[String(activeDmUserId)]?.senderName ||
                    String(activeDmUserId)}
                </div>
              </div>

              <div className="chat-live-view">
                <MessageList messages={decoratedDmMessages} bottomRef={dmBottomRef} />
              </div>

              {dmTypingUsers.length > 0 && (
                <div className="chat-typing-indicator is-visible" aria-live="polite">
                  <div className="chat-typing-dots" aria-hidden="true">
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                    <span className="chat-typing-dot" />
                  </div>
                  <span className="chat-typing-label">{dmTypingText}</span>
                </div>
              )}

              <div className="chat-input-zone">
                <ChatInput
                  onSend={handleSendDmMessage}
                  disabled={!isConnected || isTimedChatBan}
                  onTypingChange={handleDmTypingInputChange}
                />
              </div>
            </>
          ) : (
            <>
              <div className="chat-search-bar">
                <div className="chat-search-inner">
                  <span>🔎</span>
                  <input
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    placeholder="대화 검색..."
                    aria-label="1대1 대화 검색"
                  />
                </div>
              </div>

              <div className="section-scroll">
                {dmPreviewRows.length === 0 && (
                  <div className="dm-empty-state">1:1 대화 기록이 없습니다.</div>
                )}

                {dmPreviewRows.map((row, idx) => {
                  const initials = row.name.slice(0, 1).toUpperCase();
                  const rowUser = onlineUsers.find(
                    (u) => String(u.userId || u.id) === String(row.id),
                  );
                  const isAdminRow = rowUser ? isAdminUser(rowUser, myUserId, myRole) : false;
                  const status = String(
                    rowUser?.status || rowUser?.presence || rowUser?.state || "",
                  ).toLowerCase();
                  const hasExplicitOnlineFlag =
                    typeof rowUser?.isOnline === "boolean" ||
                    typeof rowUser?.online === "boolean";
                  const isOnline = rowUser
                    ? hasExplicitOnlineFlag
                      ? Boolean(rowUser?.isOnline ?? rowUser?.online)
                      : status
                        ? ["online", "active", "connected"].includes(status)
                        : true
                    : false;
                  const color = getAvatarColor(isAdminRow);
                  const unread = row.unread > 0;

                  return (
                    <div
                      key={row.id || idx}
                      className={`dm-row ${activeDmUserId === String(row.id) ? "active" : ""}`}
                      onClick={() => openDm(String(row.id))}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="dm-avatar">
                        <div className="dm-avatar__circle" style={{ background: color }}>
                          {initials}
                        </div>
                        <span className={`dm-avatar__online${isOnline ? "" : " offline"}`} />
                      </div>

                      <div className="dm-info">
                        <div className="dm-info__top">
                          <span className={`dm-info__name ${unread ? "unread" : ""}`}>{row.name}</span>
                          <span className={`dm-info__time ${unread ? "unread" : ""}`}>{row.time}</span>
                        </div>
                        <div className="dm-info__bottom">
                          <span className={`dm-info__preview ${unread ? "unread" : ""}`}>{row.preview}</span>
                          {unread && <span className="dm-unread-badge">{row.unread}</span>}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="dm-row__delete"
                        aria-label={`${row.name} 대화 삭제`}
                        title="대화 목록에서 삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteRow({ id: String(row.id), name: row.name });
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {connectionError && (
            <div
              className={`chat-conn-error ${isReconnectWaiting ? "is-waiting" : ""}`}
              role="alert"
              aria-live="polite"
            >
              {connectionError}
            </div>
          )}
        </div>
      )}

      {/* ─── DM 스레드 삭제 확인 다이얼로그 ─── */}
      {pendingDeleteRow && (
        <div
          className="chat-inline-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="1대1 대화 삭제 확인"
          onClick={() => setPendingDeleteRow(null)}
        >
          <div className="chat-inline-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="chat-inline-confirm-title">대화를 삭제할까요?</div>
            <div className="chat-inline-confirm-desc">{pendingDeleteRow.name} 대화가 목록에서 제거됩니다.</div>
            <div className="chat-inline-confirm-actions">
              <button
                type="button"
                className="chat-inline-confirm-btn cancel"
                onClick={() => setPendingDeleteRow(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="chat-inline-confirm-btn danger"
                onClick={() => {
                  if (onDeleteDmThread) {
                    onDeleteDmThread(pendingDeleteRow.id);
                  }
                  setPendingDeleteRow(null);
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 강퇴/채팅 금지 확인 다이얼로그 ─── */}
      {pendingKickUser && (
        <div
          className="chat-inline-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="유저 강퇴 확인"
          onClick={() => setPendingKickUser(null)}
        >
          <div className="chat-inline-confirm-card kick" onClick={(e) => e.stopPropagation()}>
            <div className="chat-inline-confirm-title">유저 조치를 진행할까요?</div>
            <div className="chat-inline-confirm-desc">
              {pendingKickUser?.isBulk
                ? `${pendingKickUser.name} 사용자에게 동일한 조치를 적용합니다.`
                : `${pendingKickUser.name} 사용자에게 조치를 적용합니다.`}
            </div>

            <div className="kick-reason-grid">
              {["욕설/비방", "도배/스팸", "광고", "기타"].map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`kick-reason-chip ${kickReason === item ? "active" : ""}`}
                  onClick={() => setKickReason(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="kick-ban-duration">
              <span className="kick-ban-duration__label">조치 유형</span>
              <div className="kick-ban-duration__chips">
                {[
                  { label: "강퇴만", value: 0, tone: "moderate" },
                  { label: "1일 채팅 금지", value: 86400, tone: "severe" },
                  { label: "영구 정지", value: -1, tone: "critical" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`kick-ban-chip tone-${opt.tone} ${kickBanSeconds === opt.value ? "active" : ""}`}
                    onClick={() => setKickBanSeconds(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="chat-inline-confirm-actions">
              <button
                type="button"
                className="chat-inline-confirm-btn cancel"
                onClick={() => setPendingKickUser(null)}
              >
                취소
              </button>
              <button
                type="button"
                className={`chat-inline-confirm-btn ${getModerationTone(kickBanSeconds)}`}
                onClick={() => {
                  if (onKickUser) {
                    if (pendingKickUser?.isBulk && Array.isArray(pendingKickUser?.targetIds)) {
                      pendingKickUser.targetIds.forEach((targetId) => {
                        onKickUser(targetId, kickReason, kickBanSeconds);
                      });
                      setSelectedKickUserIds([]);
                    } else {
                      onKickUser(pendingKickUser.id, kickReason, kickBanSeconds);
                      setSelectedKickUserIds((prev) =>
                        prev.filter((id) => id !== String(pendingKickUser.id)),
                      );
                    }
                  }
                  setPendingKickUser(null);
                }}
              >
                {kickBanSeconds === -1 ? "영구 정지" : kickBanSeconds > 0 ? "1일 채팅 금지" : "강제 퇴장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 하단 탭 바 ─── */}
      <div className="chat-tab-bar" role="tablist" aria-label="채팅 섹션 탭">
        {CHAT_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`chat-tab ${tab.key} ${effectiveActiveTab === tab.key ? "active" : ""} ${isTabSwitchLocked ? "is-disabled" : ""}`}
            onClick={() => {
              if (isTabSwitchLocked) return;
              setActiveTab(tab.key);
            }}
            aria-selected={effectiveActiveTab === tab.key}
            aria-disabled={isTabSwitchLocked}
            disabled={isTabSwitchLocked}
            title={isTabSwitchLocked ? "영구 정지 상태에서는 탭 전환이 제한됩니다." : undefined}
            role="tab"
          >
            <span className="tab-icon">
              <TabIcon type={tab.icon} />
              {tab.key === "chat" && chatUnreadCount > 0 && (
                <span className="chat-tab__icon-badge" aria-hidden="true">
                  {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                </span>
              )}
              {tab.key === "dm" && dmUnreadTotal > 0 && (
                <span className="chat-tab__icon-badge" aria-hidden="true">
                  {dmUnreadTotal > 99 ? "99+" : dmUnreadTotal}
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}