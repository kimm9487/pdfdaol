# PDF Summary Backend

FastAPI 기반 백엔드 서버입니다.
문서 업로드/OCR/요약/번역, 세션 기반 인증, 관리자 API, WebSocket, KakaoPay 결제를 제공합니다.

## 1. 주요 기능

- 인증/세션 관리: 로그인, 회원가입, 소셜 로그인, 세션 검증/강제 종료
- 문서 처리: 텍스트 추출, OCR, 요약, 번역, 문서 CRUD
- 관리자 기능: 사용자/문서 관리, DB/Chroma 상태 조회, 결제 로그 조회
- 결제 기능: 공개+중요 문서에 대한 KakaoPay 결제(ready/approve)
- 비동기 작업: Celery + Redis 큐 기반 문서 처리
- 실시간 기능: Socket.IO 기반 채팅/이벤트

## 2. 디렉토리 구조

```text
backend/
├── main.py
├── websocket_main.py
├── celery_app.py
├── database.py
├── database_migration.sql
├── requirements.txt
├── routers/
│   ├── auth/
│   ├── admin/
│   ├── document/
│   ├── payment/
│   └── websocket/
├── services/
│   ├── ai_service.py
│   ├── ai_service_chat.py
│   ├── ai_service_extract.py
│   ├── pdf_service.py
│   └── ocr/
├── tasks/
├── templates/
└── utils/
```

## 3. 실행 방법 (로컬)

### 3-1. 의존성 설치

```bash
cd pdf-summary/backend
pip install -r requirements.txt
```

권장: 루트의 environment.yml 기반 conda 환경 사용

### 3-2. DB 마이그레이션

```bash
cd pdf-summary/backend
mysql -u root -p < database_migration.sql
```

### 3-3. 서버 실행

```bash
cd pdf-summary/backend
python main.py
```

접속:

- API: http://localhost:8000
- OpenAPI: http://localhost:8000/docs

## 4. 실행 방법 (Docker)

루트의 pdf-summary 폴더에서 실행:

```bash
docker compose up --build
```

관련 서비스 기본 포트:

- backend: 8000
- websocket: 8001
- db(host): 3307
- redis: 6379
- chroma(host): 8002

## 5. 라우터 구성

main.py에서 아래 라우터를 등록합니다.

- /auth: 인증/세션/프로필/소셜 로그인
- /api/admin: 관리자 API
- /api/documents: 문서 처리 API
- /api/payments: 결제 API
- /socket.io: websocket 앱 마운트

## 6. 핵심 API

### 인증/세션

- POST /auth/login
- POST /auth/register
- POST /auth/logout
- GET /auth/sessions/validate
- GET /auth/sessions/current
- DELETE /auth/sessions/{session_id}

### 문서

Prefix: /api/documents

- POST /extract
- POST /summarize-document
- POST /translate
- GET /documents/{document_id}
- GET /users/{user_id}/documents
- PATCH /documents/{document_id}/public
- POST /download-selected
- GET /models
- GET /ocr-models

### 관리자

Prefix: /api/admin

- GET /documents
- PUT /documents/{document_id}
- DELETE /documents/{document_id}
- GET /documents/payment-logs
- GET /users
- DELETE /users/{user_id}
- GET /database-status
- GET /chroma-status

### 결제 (KakaoPay)

Prefix: /api/payments/kakao

- POST /ready
- POST /approve

결제 정책:

- 공개+중요 문서만 결제 대상
- 문서 소유자와 관리자는 결제 면제
- 결제 이력은 payment_transactions 테이블에 저장

## 7. 환경 변수

파일: backend/.env

### DB/공통

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=pdf_summary

CORS_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### AI/큐

```env
OLLAMA_BASE_URL=http://localhost:11434
CHROMA_BASE_URL=http://localhost:8000
CHROMA_COLLECTION=documents
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/1
```

### KakaoPay (결제 전용)

```env
KAKAO_PAY_SECRET_KEY=YOUR_SECRET_KEY
KAKAO_PAY_CID=TC0ONETIME
FRONTEND_BASE_URL=http://localhost:5173
```

중요:

- 결제 키(KAKAO_PAY_*)와 소셜 로그인 키(KAKAO_CLIENT_ID)는 별도입니다.
- 도메인 검증 오류가 나면 Kakao Developers에서 Web 플랫폼 사이트 도메인을 확인하세요.

## 8. 데이터베이스 테이블

핵심 테이블:

- users
- user_sessions
- pdf_documents
- admin_activity_logs
- payment_transactions

payment_transactions 주요 컬럼:

- document_id, user_id
- provider, status, amount
- partner_order_id, tid
- approved_at, created_at, updated_at

## 9. 개발 참고

- main.py에서 Base.metadata.create_all이 실행되어 모델 테이블을 자동 생성 시도합니다.
- 운영 환경에서는 database_migration.sql 기준으로 스키마를 관리하는 것을 권장합니다.
- CORS는 CORS_ALLOW_ORIGINS 미설정 시 localhost 기본값으로 동작합니다.
