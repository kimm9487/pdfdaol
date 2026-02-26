from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import datetime
import os

# 환경 변수 로드 (.env 파일이 없어도 기본값으로 동작하도록 설정)
load_dotenv()

# 데이터베이스 접속 정보 (전달해주신 정보로 업데이트)
DB_HOST     = os.getenv("DB_HOST", "192.168.0.151")
DB_PORT     = os.getenv("DB_PORT", "3306")
DB_USER     = os.getenv("DB_USER", "appuser1")
DB_PASSWORD = os.getenv("DB_PASSWORD", "1111")
DB_NAME     = os.getenv("DB_NAME", "pdf_summary")

# SQLAlchemy 연결 URL
DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"

# DB 엔진 및 세션 설정
engine = create_engine(DATABASE_URL, echo=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ── DB 세션 의존성 ──
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── 테이블 모델 정의 ──

# 1. 기존 PDF 문서 정보 테이블 (Numeric 제거 및 타입 수정)
class PdfDocument(Base):
    __tablename__ = "pdf_documents"

    id             = Column(Integer, primary_key=True, index=True)
    filename       = Column(String(255), nullable=False)
    extracted_text = Column(Text)
    summary        = Column(Text)
    model_used     = Column(String(100))
    char_count     = Column(Integer, default=0)
    created_at     = Column(DateTime, default=datetime.datetime.now)
    
    file_size_bytes         = Column(Integer) 
    # Numeric 대신 Float 또는 Integer를 사용하여 처리 시간을 저장합니다.
    extraction_time_seconds = Column(Integer) 

# ── 테이블 자동 생성 함수 ──
def init_db():
    # 이 함수가 실행되면 Base를 상속받은 모든 클래스(PdfDocument 등)가 테이블로 생성됩니다.
    Base.metadata.create_all(bind=engine)