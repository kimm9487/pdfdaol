# 📄 PDF 문서 요약 & 번역 시스템

사용자가 PDF 파일을 업로드하면 텍스트를 추출하고, Ollama AI를 통해 요약 및 영문 번역한 결과를 화면에 표시하는 웹 애플리케이션입니다.

---

## 🆕 주요 기능 (v2.0)

- ✅ **PDF 텍스트 추출** - PyPDF2 기반 텍스트 추출
- ✅ **AI 요약** - Ollama 기반 한국어 요약
- 🆕 **영문 번역** - 원문 및 요약의 영어 번역
- 🆕 **번역 캐시** - 동일 문서 재번역 방지
- 🆕 **상세 오류 처리** - 구체적인 실패 원인 및 해결방안 제시
- 🆕 **처리 시간 추적** - 추출/요약/번역 각 단계별 소요 시간
- 🆕 **파일 메타데이터** - 파일 크기, 페이지 수 등 상세 정보
- ✅ **결과 저장** - 모든 처리 결과를 MariaDB에 저장
- ✅ **TXT 다운로드** - 요약 결과 파일 다운로드

---

## 🖥️ 프로젝트 구조
```
pdf-summary/
├── backend/
│   ├── main.py                     # FastAPI 앱 진입점
│   ├── database.py                 # 확장된 DB 모델 정의
│   ├── database_migration.sql      # 데이터베이스 마이그레이션 스크립트
│   ├── .env                        # 환경변수 (DB 설정)
│   ├── requirements.txt            # 패키지 목록
│   ├── routers/
│   │   └── summary.py              # API 엔드포인트 (번역 기능 추가)
│   └── services/
│       ├── pdf_service.py          # 개선된 PDF 텍스트 추출
│       └── ai_service.py           # Ollama AI 요약 & 번역
└── frontend/
    └── index.html                  # 번역 기능이 추가된 프론트엔드
```

---

## ⚙️ 기술 스택

| 구분 | 기술 | 
|------|------|
| Frontend | HTML, CSS, JavaScript |
| Backend | FastAPI (Python) |
| AI | Ollama (gemma3:latest) |
| DB | MariaDB 11.4.0 |
| PDF 추출 | PyPDF2 |
| ORM | SQLAlchemy 2.0 |

---

## 🔌 API 엔드포인트

| 메서드 | 경로 | 설명 | 새기능 |
|--------|------|------|-------|
| `POST` | `/api/summarize` | PDF 업로드 → 텍스트 추출 → AI 요약 → DB 저장 | 🆕 메타데이터 저장 |
| `POST` | `/api/translate` | 문서의 원문/요약을 영문 번역 → DB 저장 | 🆕 신규 |
| `GET` | `/api/document/{id}` | 문서 전체 정보 조회 (번역 포함) | 🆕 신규 |
| `GET` | `/api/models` | 설치된 Ollama 모델 목록 조회 | - |
| `POST` | `/api/download` | 요약 결과 TXT 다운로드 | - |

---

## 🗄️ 확장된 DB 테이블 구조

### `pdf_documents` 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | INT | 자동 증가 PK |
| filename | VARCHAR(255) | 업로드 파일명 |
| extracted_text | LONGTEXT | PDF 원문 전체 |
| summary | LONGTEXT | AI 요약 결과 |
| model_used | VARCHAR(100) | 사용한 AI 모델명 |
| char_count | INT | 원문 글자 수 |
| created_at | DATETIME | 업로드 시간 |
| original_translation | LONGTEXT | 원문 영문 번역 |
| summary_translation | LONGTEXT | 요약 영문 번역 |
| translation_model | VARCHAR(100) | 번역 모델명 |
| extraction_time_seconds | DECIMAL(10,3) | 추출 소요 시간 |
| summary_time_seconds | DECIMAL(10,3) | 요약 소요 시간 |
| translation_time_seconds | DECIMAL(10,3) | 번역 소요 시간 |
| file_size_bytes | BIGINT | 파일 크기(바이트) |
| total_pages | INTEGER | 전체 페이지 수 |
| successful_pages | INTEGER | 추출 성공 페이지 수 |

---

## 🚀 설치 및 실행 방법

### 1. 환경 준비
```bash
# 가상환경 활성화
conda activate tfod

# 백엔드 의존성 설치
cd backend
pip install -r requirements.txt
```

### 2. 데이터베이스 설정
```bash
# MariaDB에서 실행
mysql -u root -p < database_migration.sql
```

또는 환경변수 설정 후:
```env
# backend/.env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=비밀번호
DB_NAME=pdf_summary
```

### 3. Ollama 실행
```bash
ollama serve
# 모델이 없을 경우: ollama pull gemma3:latest
```

### 4. 백엔드 서버 실행
```bash
cd backend
python main.py
```
> 서버 주소: http://localhost:8000  
> API 문서: http://localhost:8000/docs

### 5. 프론트엔드 실행
`frontend/index.html` 파일을 브라우저에서 열기

---

## 🆕 새로운 사용법

### 📝 기본 워크플로우
1. **PDF 업로드** → 파일 선택
2. **요약하기** → 텍스트 추출 + AI 요약 (DB 저장)
3. **번역하기** → 원문/요약 각각 영문 번역 (DB 저장)
4. **결과 확인** → 처리 시간, 메타데이터 확인

### 🔄 번역 캐시 기능
- 같은 문서를 동일 모델로 재번역 시 캐시된 결과 사용
- 번역 버튼 클릭 시 "캐시됨" 표시
- 다른 모델 선택 시 새로 번역

### ⚠️ 향상된 오류 처리
- **이미지 기반 PDF**: "OCR이 필요한 스캔 문서입니다"
- **암호화된 PDF**: "암호 해제가 필요합니다" 
- **빈 파일**: "유효한 PDF 파일을 업로드해주세요"
- **네트워크 오류**: "Ollama 서버 연결을 확인해주세요"

### 📊 처리 시간 정보
- 추출 시간: PDF → 텍스트 변환
- 요약 시간: AI 요약 생성
- 번역 시간: 영문 번역 처리
- 전체 시간: 총 소요 시간

---

## 📦 주요 패키지
```
fastapi==0.111.0
sqlalchemy==2.0.23
pymysql==1.1.0
PyPDF2==3.0.1
httpx==0.27.0
python-dotenv==1.0.1
```

---

## 📌 주의사항

- Ollama 서버가 실행 중이어야 AI 요약/번역 기능이 작동합니다
- 번역 결과는 데이터베이스에 저장되어 재사용됩니다
- 긴 텍스트는 자동으로 청킹되어 번역됩니다
- PDF가 이미지 기반인 경우 텍스트 추출이 되지 않을 수 있습니다
- 처음 실행 시 데이터베이스 테이블이 자동 생성됩니다
