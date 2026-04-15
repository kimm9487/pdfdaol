// src/components/websocketchat/WebSocketDateSeparator.jsx
import { format, isToday, isYesterday } from 'date-fns';
import ko from 'date-fns/locale/ko';

export default function DateDivider({ date }) {
  let label = format(date, 'yyyy년 M월 d일 EEEE', { locale: ko });

  if (isToday(date)) label = '오늘';
  else if (isYesterday(date)) label = '어제';

  return (
    <div className="chat-date-divider">
      <span className="chat-date-divider__line" />
      <span className="chat-date-divider__label">
        {label}
      </span>
      <span className="chat-date-divider__line" />
    </div>
  );
}

// commit touch: 260327_웹소켓 도커 최종