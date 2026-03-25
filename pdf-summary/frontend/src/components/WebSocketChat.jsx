/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from "react";
import WebSocketChatWindow from "./websocketchat/WebSocketChatWindow";
import "./websocketchat/WebSocketChat.css";

import { io } from "socket.io-client";
import { SOCKET_ORIGIN } from "../config/api";

export default function WebSocketChat() {
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [connectionError, setConnectionError] = useState(null);

  const userId = localStorage.getItem("userId");
  const sessionToken = localStorage.getItem("session_token");
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";

  const getStorageKey = () =>
    userId && sessionToken
      ? `chat_messages_user_${userId}_sess_${sessionToken.slice(-12)}`
      : null;

  // ==================== 로그인 직후 백그라운드 연결 ====================
  useEffect(() => {
    if (!isLoggedIn || !sessionToken || !userId) {
      if (socket) socket.disconnect();
      setMessages([]);
      setUnreadCount(0);
      setOnlineUsers([]);
      setIsConnected(false);
      return;
    }


    // 환경변수 기반 동적 연결 (SOCKET_ORIGIN)
    const newSocket = io(SOCKET_ORIGIN, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 30,
      reconnectionDelay: 2000,
      timeout: 30000,
      auth: { session_token: sessionToken },
      withCredentials: true,
    });

    console.log("[Socket] 연결 시도:", SOCKET_ORIGIN + "/socket.io");

    newSocket.on("connect", () => {
      console.log("[Background Socket] 연결 성공!");
      setIsConnected(true);
    });

    newSocket.on("connect_error", (err) => {
      console.error("[Socket] 연결 실패:", err.message);
      setConnectionError(err.message);
      setIsConnected(false);
    });

    newSocket.on("initMessages", (pastMessages) => {
      if (Array.isArray(pastMessages) && pastMessages.length > 0) {
        // 초기 메시지는 모두 읽음 처리
        const messagesWithReadStatus = pastMessages.map(msg => ({
          ...msg,
          isRead: msg.isRead !== undefined ? msg.isRead : true
        }));
        setMessages(messagesWithReadStatus);
        const key = getStorageKey();
        if (key) localStorage.setItem(key, JSON.stringify(messagesWithReadStatus));
      }
    });

    newSocket.on("receiveMessage", (payload) => {
      const msg = payload?.content ? payload : payload?.[0] || payload;
      const currentUserId = localStorage.getItem("userId");
      const isMyMessage = String(msg.senderId || msg.sender || msg.userId) === String(currentUserId);
      
      const safeMsg = {
        senderId: msg.senderId || msg.sender || msg.userId,
        content: msg.content || msg.message || msg.text,
        timestamp: msg.timestamp || new Date().toISOString(),
        isSystem: msg.isSystem || false,
        isRead: isMyMessage, // 내 메시지는 기본 읽음, 상대 메시지는 읽지 않음
      };
      setMessages((prev) => [...prev, safeMsg]);
    });

    newSocket.on("onlineUsers", (users) => {
      setOnlineUsers(users || []);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isLoggedIn, sessionToken, userId]);

  // F5 새로고침 시 localStorage 복구
  useEffect(() => {
    if (!isLoggedIn || !userId || !sessionToken) return;
    const key = getStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed);
      } catch (e) {
        console.error("[LocalStorage] 메시지 파싱 실패:", e);
      }
    }
  }, [isLoggedIn, userId, sessionToken]);

  // 로그아웃 시 정리
  useEffect(() => {
    if (!isLoggedIn) {
      const key = getStorageKey();
      if (key) localStorage.removeItem(key);
      setMessages([]);
      setUnreadCount(0);
      setOnlineUsers([]);
    }
  }, [isLoggedIn]);

  // ==================== 안 읽은 배지 로직 (카톡처럼) ====================
  // 채팅창 열 때: 모든 메시지를 읽음으로 표시
  useEffect(() => {
    if (showChat) {
      setMessages((prev) =>
        prev.map((msg) => ({ ...msg, isRead: true }))
      );
      setUnreadCount(0);
    }
  }, [showChat]);

  // 메시지 변경 시: 읽지 않은 메시지 개수 계산
  useEffect(() => {
    if (!showChat) {
      // 채팅창이 닫혀 있을 때만 안읽음 카운트 계산
      const count = messages.filter(
        (msg) => !msg.isSystem && !msg.isRead
      ).length;
      setUnreadCount(count);
    }
  }, [messages, showChat]);

  const handleSendMessage = (text) => {
    if (!text?.trim() || !socket?.connected) return false;
    socket.emit("sendMessage", { content: text });
    return true;
  };

  if (!isLoggedIn) return null;

  return (
    <>
      <button
        className="floating-chat-btn relative"
        onClick={() => setShowChat((prev) => !prev)}
        title="실시간 채팅 열기"
      >
        💬
        {unreadCount > 0 && (
          <span
            key={`unread-${unreadCount}`}
            className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-md border-2 border-white animate-pulse"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {showChat && (
        <div className="floating-chat-panel">
          <div className="chat-header">
            <h3>실시간 채팅</h3>
            <button onClick={() => setShowChat(false)}>✕</button>
          </div>

          <div className="chat-body">
            <WebSocketChatWindow
              messages={messages}
              onSend={handleSendMessage}
              isConnected={isConnected}
              onlineUsers={onlineUsers}
              connectionError={connectionError}
              isOpen={showChat}
            />
          </div>
        </div>
      )}
    </>
  );
}