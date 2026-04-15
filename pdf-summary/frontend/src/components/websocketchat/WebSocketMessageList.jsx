// src/components/websocketchat/WebSocketMessageList.jsx
import { useMemo } from "react";
import MessageBubble from "./WebSocketMessageItem";
import DateDivider from "./WebSocketDateSeparator";

export default function MessageList({ messages, bottomRef }) {
  const groupedItems = useMemo(() => {
    const items = [];
    let prevDateKey = null;

    (Array.isArray(messages) ? messages : []).forEach((msg, index) => {
      const msgDate =
        msg.timestamp && !isNaN(new Date(msg.timestamp))
          ? new Date(msg.timestamp)
          : new Date();
      const dateKey = msgDate.toDateString();

      // 날짜 구분선
      if (dateKey !== prevDateKey) {
        prevDateKey = dateKey;
        items.push({ type: "divider", date: msgDate });
      }

      // 연속 메시지 판단 (목표 1, 3 반영)
      const prev = index > 0 ? messages[index - 1] : null;
      const timeDiff = prev ? msgDate - new Date(prev.timestamp) : Infinity;
      const isSameUser = prev && prev.senderId === msg.senderId;
      const isContinuous = isSameUser && timeDiff < 5 * 60 * 1000; // 5분 이내

      items.push({
        type: "message",
        ...msg,
        isContinuous,
        showSenderInfo: !isContinuous, // 첫 메시지에만 표시 (목표 1, 3)
      });
    });

    return items;
  }, [messages]);

  return (
    <div className="chat-messages">
      {groupedItems.map((item, idx) => {
        if (item.type === "divider") {
          return <DateDivider key={`divider-${idx}`} date={item.date} />;
        }
        return (
          <MessageBubble
            key={`${item.senderId}-${item.timestamp}-${idx}`}
            message={item}
            showSenderInfo={item.showSenderInfo}
            isContinuous={item.isContinuous}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}