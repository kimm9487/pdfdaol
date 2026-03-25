// src/components/websocketchat/WebSocketDateSeparator.jsx
import { format, isToday, isYesterday } from 'date-fns';
import ko from 'date-fns/locale/ko';

export default function DateDivider({ date }) {
  let label = format(date, 'yyyy년 M월 d일 EEEE', { locale: ko });

  if (isToday(date)) label = '오늘';
  else if (isYesterday(date)) label = '어제';

  return (
    <div className="flex justify-center my-6">
      <span className="px-5 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm rounded-full font-medium">
        {label}
      </span>
    </div>
  );
}