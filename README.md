# Daol Mini Project

PDF/문서 업로드부터 OCR, AI 요약/번역, 대화형 질의응답, 관리자 운영, 결제 연동까지 포함한 통합 서비스입니다.

## 1. 문서 구성

- 루트 통합 문서: 이 파일
- 백엔드 상세 문서: pdf-summary/backend/README.md
- 프론트 상세 문서: pdf-summary/frontend/README.md

## 2. 전체 구조

```text
daol_minipro/
├── README.md
├── environment.yml
├── conda_packages.txt
├── conda_pip.txt
└── pdf-summary/
    ├── docker-compose.yml
    ├── backend/
    │   ├── README.md
    │   ├── main.py
    │   ├── websocket_main.py
    │   ├── celery_app.py
    │   ├── database.py
    │   ├── database_migration.sql
    │   ├── requirements.txt
    │   ├── routers/
    │   │   ├── auth/
    │   │   ├── admin/
    │   │   ├── document/
    │   │   ├── payment/
    │   │   └── websocket/
    │   ├── services/
    │   ├── tasks/
    │   └── utils/
    ├── frontend/
    │   ├── README.md
    │   ├── package.json
    │   ├── vite.config.js
    │   └── src/
    │       ├── components/
    │       ├── config/
    │       ├── hooks/
    │       └── pages/
    ├── db-backups/
    └── frontend_old/
```

## 3. 핵심 기능

- 문서 업로드, OCR, 요약, 번역
- 문서 기반 대화형 Q&A
- 공개/비공개, 중요문서 비밀번호, 다운로드(CSV/ZIP)
- 관리자 대시보드(사용자/문서/시스템/결제 로그)
- KakaoPay 결제 연동(공개+중요 문서)

## 4. 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| Frontend | React 19, Vite, React Router DOM 7, socket.io-client |
| Backend | FastAPI, Uvicorn, SQLAlchemy, python-socketio |
| Async | Celery, Redis, Flower |
| DB | MariaDB |
| AI/OCR | Ollama, ChromaDB, PyPDF2, Tesseract, EasyOCR/PaddleOCR |
| Infra | Docker Compose |

## 5. 실행 방법

### 5-1. Docker 실행 (권장)

```bash
cd pdf-summary
docker compose up --build
```

기본 포트:

- frontend: 5173
- backend: 8000
- websocket: 8001
- mariadb(host): 3307
- redis: 6379
- chroma(host): 8002
- ollama: 11434
- flower: 5555

종료/초기화:

```bash
docker compose down
docker compose down -v
```

### 5-2. 로컬 실행

```bash
conda env create -f environment.yml
conda activate tfod

cd pdf-summary/backend
pip install -r requirements.txt
mysql -u root -p < database_migration.sql
python main.py

cd ../frontend
npm install
npm run dev
```

접속:

- API: http://localhost:8000
- OpenAPI: http://localhost:8000/docs
- Frontend: http://localhost:5173

## 6. 백엔드 통합 요약

라우터 구성:

- /auth: 로그인/회원가입/소셜로그인/세션
- /api/documents: 추출/요약/번역/문서CRUD/다운로드
- /api/admin: 사용자/문서/시스템/결제로그
- /api/payments: KakaoPay ready/approve
- /socket.io: websocket

핵심 테이블:

- users
- user_sessions
- pdf_documents
- admin_activity_logs
- payment_transactions

대표 엔드포인트:

- POST /auth/login
- POST /auth/register
- GET /auth/sessions/validate
- POST /api/documents/extract
- POST /api/documents/summarize-document
- POST /api/documents/translate
- GET /api/admin/documents
- GET /api/admin/documents/payment-logs
- POST /api/payments/kakao/ready
- POST /api/payments/kakao/approve

## 7. 프론트엔드 통합 요약

주요 페이지:

- HomeHub
- PdfSummary
- ChatSummary
- MyPage
- UserList
- AdminDashboard
- Payment/KakaoSuccess, Payment/KakaoFail

라우팅:

- 공개: /login, /register, /payments/kakao/success, /payments/kakao/fail
- 보호: /, /pdf-summary, /chat-summary, /mypage, /userlist, /admin

결제 동작:

1. UserList에서 결제 대상 문서 선택
2. /api/payments/kakao/ready 호출
3. 결제창 팝업 오픈
4. 결제 콜백 페이지에서 승인/실패 처리
5. postMessage로 부모창(UserList) 상태 갱신

## 8. 환경 변수

백엔드 파일: pdf-summary/backend/.env

기본:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pdf_summary
CORS_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
OLLAMA_BASE_URL=http://localhost:11434
CHROMA_BASE_URL=http://localhost:8000
```

KakaoPay 결제 전용:

```env
KAKAO_PAY_SECRET_KEY=YOUR_SECRET_KEY
KAKAO_PAY_CID=TC0ONETIME
FRONTEND_BASE_URL=http://localhost:5173
```

주의:

- 결제 키(KAKAO_PAY_*)와 소셜 로그인 키(KAKAO_CLIENT_ID)는 별도입니다.
- 결제 도메인 검증 오류 발생 시 Kakao Developers Web 플랫폼 사이트 도메인을 확인하세요.

## 9. 결제 정책

- 공개+중요 문서만 결제 대상
- 문서 소유자/관리자는 결제 면제
- 결제 이력은 payment_transactions에 저장
- 관리자 결제 로그 조회: /api/admin/documents/payment-logs

## 10. 상세 문서

- Backend 상세: pdf-summary/backend/README.md
- Frontend 상세: pdf-summary/frontend/README.md
