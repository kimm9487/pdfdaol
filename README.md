# PDF 문서 요약/번역 시스템

PDF 파일 업로드 후 텍스트를 추출하고, Ollama 모델로 요약 및 영어 번역을 수행하는 웹 애플리케이션입니다. 결과는 MariaDB에 저장되며, 일반/관리자 기능이 분리되어 있습니다.

---

## 주요 기능

- PDF 텍스트 추출
- AI 요약 생성
- 원문/요약 영어 번역
- 번역 결과 캐시(동일 문서/모델 재요청 시 재사용)
- 문서 공개/비공개 전환
- 중요 문서(비밀번호) 처리
- 사용자/관리자 문서 관리(조회/수정/삭제)
- 선택 문서 CSV/ZIP 다운로드
- 로그인 세션 검증 및 강제 로그아웃

---

## 프로젝트 구조

```text
daol_minipro/
├── README.md
├── environment.yml
├── conda_packages.txt
├── conda_pip.txt
└── pdf-summary/
    ├── docker-compose.yml
    ├── backend/
    │   ├── main.py
    │   ├── database.py
    │   ├── database_migration.sql
    │   ├── requirements.txt
    │   ├── routers/
    │   │   ├── auth.py
    │   │   ├── sessions.py
    │   │   ├── find_account.py
    │   │   ├── summary.py
    │   │   ├── is_public.py
    │   │   ├── history.py
    │   │   ├── admin.py
    │   │   └── download.py
    │   └── services/
    │       ├── pdf_service.py
    │       └── ai_service.py
    ├── frontend/
    │   ├── package.json
    │   └── src/
    └── frontend_old/
```

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | React, Vite, React Router |
| Backend | FastAPI, Uvicorn |
| AI | Ollama |
| DB | MariaDB |
| ORM | SQLAlchemy |
| PDF 처리 | PyPDF2 |

---

## 실행 방법 (로컬)

### 1. Python 환경 및 백엔드 의존성

```bash
conda activate tfod
cd pdf-summary/backend
pip install -r requirements.txt
```

### 2. 데이터베이스 준비

```bash
cd pdf-summary/backend
mysql -u root -p < database_migration.sql
```

환경변수 예시(`pdf-summary/backend/.env`):

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=비밀번호
DB_NAME=pdf_summary
```

### 3. Ollama 실행

```bash
ollama serve
# 필요 시
ollama pull gemma3:latest
```

### 4. 백엔드 실행

```bash
cd pdf-summary/backend
python main.py
```

- API: `http://localhost:8000`
- Docs: `http://localhost:8000/docs`

### 5. 프론트엔드 실행

```bash
cd pdf-summary/frontend
npm install
npm run dev
```

- Frontend: `http://localhost:5173`

---

## 실행 방법 (Docker)

선택: 루트 비밀번호/DB 계정 정보를 바꾸려면 `pdf-summary/.env` 파일을 만듭니다.

```env
MARIADB_ROOT_PASSWORD=9487
MARIADB_DATABASE=pdf_summary
MARIADB_USER=pdf_user
MARIADB_PASSWORD=pdf_user_pw
```

```bash
cd pdf-summary
docker compose up --build
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:5173`
- DB: `localhost:3306` (컨테이너명: `pdf_db`)

초기 SQL(`backend/database_migration.sql`)은 DB 볼륨이 비어 있는 첫 실행 시 자동 적용됩니다.
DB를 완전히 초기화하려면 아래 명령으로 볼륨까지 삭제 후 재실행합니다.

```bash
docker compose down -v
docker compose up --build
```

---

## 주요 API

### 인증/계정

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/auth/register` | 회원가입 |
| `POST` | `/auth/login` | 로그인 |
| `POST` | `/auth/logout` | 로그아웃 |
| `GET` | `/auth/check-id` | 아이디 중복 확인 |
| `GET` | `/auth/profile/{user_db_id}` | 프로필 조회 |
| `PUT` | `/auth/profile/{user_db_id}` | 프로필 수정 |

### 계정 찾기

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/auth/send-code-find-id` | 아이디 찾기 인증코드 발송 |
| `POST` | `/auth/send-code-reset-pw` | 비밀번호 재설정 인증코드 발송 |
| `POST` | `/auth/verify-find-id` | 아이디 찾기 인증 확인 |
| `POST` | `/auth/verify-code` | 비밀번호 재설정 인증 확인 |
| `POST` | `/auth/reset-password` | 비밀번호 재설정 |

### 문서/요약/번역 (`/api`)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/summarize` | PDF 업로드 및 요약 저장 |
| `POST` | `/api/translate` | 원문/요약 영어 번역 |
| `GET` | `/api/document/{document_id}` | 문서 상세 조회 |
| `GET` | `/api/documents/{user_id}` | 사용자 문서 목록 조회 |
| `PUT` | `/api/summarize/{document_id}` | 문서 수정 |
| `DELETE` | `/api/summarize/{document_id}` | 문서 삭제 |
| `GET` | `/api/models` | 사용 가능한 모델 목록 |
| `POST` | `/api/download` | 요약 TXT 다운로드 |
| `PATCH` | `/api/document/{document_id}/public` | 공개/비공개 변경 |

### 관리자/다운로드

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/admin/documents` | 전체 문서 조회 |
| `DELETE` | `/api/admin/documents/{document_id}` | 문서 삭제 |
| `PUT` | `/api/admin/documents/{document_id}` | 문서 수정 |
| `POST` | `/api/admin/download-selected` | 선택 문서 CSV/ZIP 다운로드 |
| `GET` | `/auth/users` | 전체 회원 조회 |
| `DELETE` | `/auth/users/{user_id}` | 회원 삭제 |

### 세션/히스토리

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/auth/sessions/validate` | 세션 유효성 확인 |
| `GET` | `/auth/sessions/current` | 현재 활성 세션 조회 |
| `DELETE` | `/auth/sessions/{session_id}` | 특정 세션 종료 |
| `GET` | `/auth/login-history` | 로그인 이력 조회 |
| `GET` | `/auth/admin/sessions` | 관리자용 세션 목록 조회 |
| `GET` | `/api/history/{user_db_id}` | 사용자 문서 히스토리 조회 |

---

## 참고 사항

- Ollama 서버가 실행 중이어야 요약/번역 API가 정상 동작합니다.
- 중요 문서가 포함된 선택 다운로드는 ZIP(보호 파일 포함)으로 생성될 수 있습니다.
- 백엔드는 `main.py`에서 라우터를 분리 등록하여 사용합니다.
