# PDF Summary Frontend

React + Vite 기반 프론트엔드입니다.
문서 업로드/OCR/요약/번역, 대화형 요약, 관리자 기능, 결제 연동 UI를 제공합니다.

## 주요 기능

- 로그인/회원가입/소셜 로그인
- PDF 및 문서 업로드, OCR 모델 선택, 요약/번역
- 문서 기반 대화형 질의응답
- 마이페이지(이력 조회, 프로필 관리)
- 관리자 대시보드(사용자/문서/시스템/결제 로그)
- 요약 목록 결제 정책 UI
	- 공개+중요+미결제 문서는 결제 버튼 표시
	- 결제 완료 시 배지/열람 상태 즉시 갱신
- KakaoPay 결제 팝업 콜백 처리

## 기술 스택

- React 19
- Vite 7
- React Router DOM 7
- react-hot-toast
- socket.io-client

## 폴더 구조

```text
frontend/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── WebSocketChat.jsx
│   │   └── GuideChatbot/
│   ├── config/
│   │   └── api.js
│   ├── hooks/
│   │   ├── useLogin.js
│   │   ├── useLogout.js
│   │   ├── usePdfSummary.js
│   │   ├── useUserList.js
│   │   ├── useDocumentHistory.js
│   │   ├── useSessionValidator.js
│   │   └── useAuthRedirect.js
│   ├── pages/
│   │   ├── HomeHub/
│   │   ├── PdfSummary/
│   │   ├── ChatSummary/
│   │   ├── MyPage/
│   │   ├── UserList/
│   │   ├── AdminDashboard/
│   │   ├── Login/
│   │   ├── Register/
│   │   └── Payment/
│   │       ├── KakaoSuccess.jsx
│   │       └── KakaoFail.jsx
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── vite.config.js
└── package.json
```

## 주요 라우트

- 공개 라우트
	- /login
	- /register
	- /payments/kakao/success
	- /payments/kakao/fail
- 보호 라우트
	- /
	- /pdf-summary
	- /chat-summary
	- /mypage
	- /userlist
	- /admin

참고:

- 결제 성공/실패 라우트는 팝업 콜백 처리를 위해 보호 라우트에서 제외되어 있습니다.
- 팝업에서 부모창으로 postMessage를 보내 결제 상태를 갱신합니다.

## API 설정

파일: src/config/api.js

- API_BASE = {API_ORIGIN}/api
- buildApiUrl(path) 헬퍼 제공
- VITE_API_URL, VITE_API_PORT, VITE_SOCKET_URL, VITE_SOCKET_PORT 지원

프론트 .env 예시:

```env
VITE_API_URL=http://localhost:8000
VITE_SOCKET_URL=ws://localhost:8001
```

## 실행 방법

```bash
npm install
npm run dev
```

- 기본 개발 서버: http://localhost:5173

빌드/검증:

```bash
npm run build
npm run preview
npm run lint
```

## 결제 연동 동작 요약

1. 요약 목록에서 결제 대상 문서 클릭
2. /api/payments/kakao/ready 호출
3. KakaoPay 결제창을 새 팝업으로 열기
4. 팝업 콜백(/payments/kakao/success|fail)에서 결과 처리
5. 부모창(UserList)으로 결과 전달 후 결제 배지/열람 상태 업데이트

## 개발 시 유의사항

- 로그인 세션 검증은 useSessionValidator 훅에서 수행됩니다.
- 결제 콜백 페이지는 세션 검증에 의해 리디렉트되지 않도록 별도 공개 라우트로 유지해야 합니다.
- 결제 정책 UI는 백엔드 응답 필드(requires_payment, is_paid_by_viewer)에 의존합니다.
