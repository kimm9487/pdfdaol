
# Daol Project: PDF 요약/번역/대화형 AI 시스템

PDF/문서/이미지 업로드, AI 요약/번역, 대화형 LLM, 가이드 챗봇, 실시간 웹소켓 채팅, 관리자 기능, 세션 관리 등 다양한 기능을 제공하는 통합 웹 애플리케이션입니다.

---

---

## 주요 기능

- 다양한 문서 포맷 업로드 및 OCR/AI 요약/번역
- 크로마DB 기반 벡터 검색 및 문서 임베딩
- Ollama 기반 대화형 LLM(문서 질의응답, 요약, 번역)
- 실시간 웹소켓 채팅(문서/AI/관리자/유저 간)
- 가이드 챗봇(초보자 안내, FAQ)
- 관리자/사용자 권한 분리, 세션 및 이력 관리
- 문서 공개/비공개, 중요 문서 보호, CSV/ZIP 다운로드
- 실시간 대시보드, 통계, 알림

---

## 프로젝트 구조

```text
daol_minipro/
├── README.md
├── environment.yml / conda_packages.txt / conda_pip.txt
└── pdf-summary/
  ├── docker-compose.yml
  ├── backend/
  │   ├── main.py                # FastAPI 진입점, WebSocket 서버
  │   ├── celery_app.py          # Celery 태스크 큐
  │   ├── database.py           # SQLAlchemy, MariaDB 연동
  │   ├── requirements.txt      # 백엔드 의존성
  │   ├── routers/              # API 라우터 (auth, admin, document, websocket 등)
  │   ├── services/
  │   │   ├── ai_service.py, ai_service_chat.py, ai_service_extract.py  # LLM/챗봇/추출
  │   │   ├── pdf_service.py    # PDF/이미지 처리
  │   │   └── ocr/              # easyocr, paddleocr, tesseract 등 OCR 엔진
  │   ├── tasks/                # 비동기 문서 처리 태스크
  │   ├── utils/                # 인증, 이메일, 디스코드 등 유틸
  │   ├── websocket_main.py     # 웹소켓 서버 진입점
  │   └── Dockerfile            # CUDA/AI 환경용
  ├── frontend/
  │   ├── package.json, Dockerfile
  │   └── src/
  │       ├── components/       # GuideChatbot, WebSocketChat 등
  │       ├── pages/            # PdfSummary, AdminDashboard, ChatSummary 등
  │       └── ...
  ├── db-backups/               # DB 백업 SQL
  └── frontend_old/             # 레거시 프론트엔드
```

---

## 기술 스택


| 구분          | 기술/라이브러리                                   |
| ------------- | ------------------------------------------------ |
| Frontend      | React 19, Vite, React Router, WebSocket, GuideChatbot |
| Backend       | FastAPI, Uvicorn, Celery, WebSocket, python-socketio |
| AI/LLM        | Ollama, ChromaDB(벡터DB), PyTorch, PaddleOCR, EasyOCR, Tesseract |
| DB            | MariaDB                                          |
| ORM           | SQLAlchemy                                       |
| 기타          | Docker, docker-compose, Redis, Flower, etc.      |

---

## 실행 방법 (로컬)

### 1. 백엔드 의존성 설치

#### (1) conda 환경 생성/동기화
최신 환경 전체 복원:
```bash
conda env create -f environment.yml
conda activate tfod
```
또는 기존 환경 업데이트:
```bash
conda env update -f environment.yml --prune
conda activate tfod
```

#### (2) pip 패키지 추가 설치(필요시)
```bash
cd pdf-summary/backend
pip install -r requirements.txt
```

> requirements.txt는 최소 실행 패키지 목록입니다. 전체 환경 동기화는 environment.yml/conda_packages.txt/conda_pip.txt 참고.
> easyocr, paddleocr, torch 등 일부 대형 패키지는 conda/Docker로 설치 권장(의존성 충돌 방지).


### 2. DB 준비

```bash
cd pdf-summary/backend
mysql -u root -p < database_migration.sql
```


환경변수 예시: `pdf-summary/backend/.env`

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=비밀번호
DB_NAME=pdf_summary
OLLAMA_BASE_URL=http://localhost:11434
```


### 3. Ollama 실행

```bash
ollama serve
ollama pull gemma3:latest
```


### 4. 백엔드 실행

```bash
cd pdf-summary/backend
python main.py
```

- API: `http://localhost:8000`
- OpenAPI Docs: `http://localhost:8000/docs`


### 5. 프론트엔드 실행
---
## 패키지/환경 관리 주의사항

- tfod 가상환경의 전체 패키지 목록은 conda_packages.txt, conda_pip.txt, environment.yml에 저장되어 있습니다.
- requirements.txt는 최소 실행 패키지(코드 의존성 기준)만 포함합니다.
- 환경 동기화가 필요할 때는 conda env export > environment.yml, pip freeze > conda_pip.txt 등으로 갱신하세요.
- easyocr, paddleocr, torch 등 대형 패키지는 conda/Docker로 설치 권장(의존성 충돌 방지).
- 환경/패키지 변경 후에는 반드시 재실행 및 호환성 확인 바랍니다.

```bash
cd pdf-summary/frontend
npm install
npm run dev
```

- Frontend: `http://localhost:5173`

---

## 실행 방법 (Docker)

선택: `pdf-summary/.env`로 Docker 환경변수를 덮어쓸 수 있습니다.

```env
MARIADB_ROOT_PASSWORD=9487
MARIADB_DATABASE=pdf_summary
MARIADB_USER=pdf_user
MARIADB_PASSWORD=pdf_user_pw
OLLAMA_BASE_URL=http://ollama:11434
```

```bash
cd pdf-summary
docker compose up --build

# 최초 1회 모델 다운로드
docker compose exec ollama ollama pull gemma3:latest
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173`
- DB: `localhost:3307` (`pdf_db` 컨테이너의 `3306` 포트를 호스트 `3307`로 매핑)
- Ollama: `http://localhost:11434`

초기 SQL(`backend/database_migration.sql`)은 DB 볼륨이 비어 있는 첫 실행 시 자동 적용됩니다.
DB까지 완전 초기화하려면:

```bash
docker compose down -v
docker compose up --build
```

---

## API 개요

`summary_router`와 `is_public_router`는 `main.py`에서 `/api` prefix로 등록됩니다.
아래 경로는 최종 호출 경로 기준입니다.

### 인증/계정

| 메서드   | 경로                         | 설명             |
| -------- | ---------------------------- | ---------------- |
| `POST`   | `/auth/register`             | 회원가입         |
| `POST`   | `/auth/login`                | 로그인           |
| `POST`   | `/auth/logout`               | 로그아웃         |
| `GET`    | `/auth/check-id`             | 아이디 중복 확인 |
| `GET`    | `/auth/profile/{user_db_id}` | 프로필 조회      |
| `PUT`    | `/auth/profile/{user_db_id}` | 프로필 수정      |
| `DELETE` | `/auth/withdraw/{username}`  | 회원 탈퇴        |

### 계정 찾기

| 메서드 | 경로                       | 설명                          |
| ------ | -------------------------- | ----------------------------- |
| `POST` | `/auth/send-code-find-id`  | 아이디 찾기 인증코드 발송     |
| `POST` | `/auth/send-code-reset-pw` | 비밀번호 재설정 인증코드 발송 |
| `POST` | `/auth/verify-find-id`     | 아이디 찾기 인증 확인         |
| `POST` | `/auth/verify-code`        | 비밀번호 재설정 인증 확인     |
| `POST` | `/auth/reset-password`     | 비밀번호 재설정               |

### 문서/요약/번역 (`/api`)

| 메서드   | 경로                                 | 설명                            |
| -------- | ------------------------------------ | ------------------------------- |
| `POST`   | `/api/extract`                       | 파일 업로드 및 텍스트 추출/저장 |
| `POST`   | `/api/summarize-document`            | 추출된 문서 요약 실행           |
| `POST`   | `/api/summarize`                     | (레거시) 업로드+요약 일괄 처리  |
| `POST`   | `/api/translate`                     | 원문/요약 영어 번역             |
| `GET`    | `/api/document/{document_id}`        | 문서 상세 조회                  |
| `GET`    | `/api/documents/{user_id}`           | 사용자 문서 목록 조회           |
| `PUT`    | `/api/summarize/{document_id}`       | 문서 수정                       |
| `DELETE` | `/api/summarize/{document_id}`       | 문서 삭제                       |
| `GET`    | `/api/models`                        | 사용 가능한 LLM 모델 목록       |
| `GET`    | `/api/ocr-models`                    | 사용 가능한 OCR 모델 목록       |
| `POST`   | `/api/download`                      | 요약 TXT 다운로드               |
| `PATCH`  | `/api/document/{document_id}/public` | 공개/비공개 변경                |
| `GET`    | `/api/history/{user_db_id}`          | 사용자 문서 히스토리 조회       |

### 관리자/다운로드

| 메서드   | 경로                                 | 설명                       |
| -------- | ------------------------------------ | -------------------------- |
| `GET`    | `/api/admin/documents`               | 전체 문서 조회             |
| `DELETE` | `/api/admin/documents/{document_id}` | 문서 삭제                  |
| `PUT`    | `/api/admin/documents/{document_id}` | 문서 수정                  |
| `POST`   | `/api/admin/download-selected`       | 선택 문서 CSV/ZIP 다운로드 |
| `GET`    | `/auth/users`                        | 전체 회원 조회             |
| `DELETE` | `/auth/users/{user_id}`              | 회원 삭제                  |

### 세션

| 메서드   | 경로                                | 설명                         |
| -------- | ----------------------------------- | ---------------------------- |
| `GET`    | `/auth/sessions/validate`           | 세션 유효성 확인             |
| `GET`    | `/auth/sessions/current`            | 현재 활성 세션 조회          |
| `DELETE` | `/auth/sessions/{session_id}`       | 특정 세션 종료               |
| `GET`    | `/auth/login-history`               | 로그인 이력 조회             |
| `GET`    | `/auth/admin/sessions`              | 관리자용 활성 세션 목록 조회 |
| `DELETE` | `/auth/admin/sessions/{session_id}` | 관리자용 세션 강제 종료      |

---

## 업로드/OCR 지원 형식

- `pypdf2`: `.pdf`만 지원
- `tesseract`, `easyocr`, `paddleocr`:
  `.pdf`, `.doc`, `.docx`, `.hwpx`, `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`, `.tif`, `.tiff`, `.gif`
- 구형 `.hwp`는 변환 한계로 실패 가능성이 있어 `.hwpx`, `.docx`, `.pdf` 변환 후 업로드를 권장합니다.

---

## 참고 사항

- CORS 허용 기본값은 `localhost:5173`, `localhost:5174`, `localhost:3000`, `localhost:8000` 등으로 설정되어 있으며, `CORS_ALLOW_ORIGINS`로 오버라이드할 수 있습니다.
- 중요 문서가 포함된 선택 다운로드는 자동으로 ZIP 모드가 적용될 수 있습니다.
- 문서 업로드의 핵심 처리 함수는 `pdf-summary/backend/routers/summary.py`의 `_build_extraction_document()`입니다.
- 백엔드 실행 진입점은 `pdf-summary/backend/main.py`입니다.

