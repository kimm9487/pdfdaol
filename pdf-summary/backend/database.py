from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, DECIMAL, BigInteger, Boolean, Enum, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import sessionmaker, relationship
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


# ── 사용자 관리 모델 ──
class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100))
    role = Column(Enum('admin', 'user', name='user_roles'), default='user', index=True)
    created_at = Column(DateTime, default=datetime.datetime.now)
    updated_at = Column(DateTime, default=datetime.datetime.now, onupdate=datetime.datetime.now)
    last_login_at = Column(DateTime)
    is_active = Column(Boolean, default=True, index=True)
    
    # 관계 설정
    documents = relationship("PdfDocument", back_populates="owner")
    sessions = relationship("UserSession", back_populates="user")
    admin_logs = relationship("AdminActivityLog", back_populates="admin_user")


class UserSession(Base):
    __tablename__ = "user_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    session_token = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.now)
    expires_at = Column(DateTime, nullable=False, index=True)
    is_active = Column(Boolean, default=True, index=True)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    
    # 관계 설정
    user = relationship("User", back_populates="sessions")


class AdminActivityLog(Base):
    __tablename__ = "admin_activity_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    admin_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(50))
    target_id = Column(Integer)
    details = Column(Text)  # JSON으로 저장
    created_at = Column(DateTime, default=datetime.datetime.now, index=True)
    ip_address = Column(String(45))
    
    # 관계 설정
    admin_user = relationship("User", back_populates="admin_logs")


# ── PDF 문서 모델 (업데이트됨) ──
class PdfDocument(Base):
    __tablename__ = "pdf_documents"

    # 기본 필드
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # 추가됨
    filename = Column(String(255), nullable=False)
    extracted_text = Column(LONGTEXT)
    summary = Column(LONGTEXT)
    model_used = Column(String(100))
    char_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.now, index=True)
    updated_at = Column(DateTime, default=datetime.datetime.now, onupdate=datetime.datetime.now)  # 추가됨
    
    # 번역 관련 필드
    original_translation = Column(LONGTEXT, comment="원문 영문 번역")
    summary_translation = Column(LONGTEXT, comment="요약 영문 번역")
    translation_model = Column(String(100), comment="번역에 사용된 모델")
    
    # 처리 시간 추적 필드
    extraction_time_seconds = Column(DECIMAL(10,3), comment="텍스트 추출 소요 시간(초)")
    summary_time_seconds = Column(DECIMAL(10,3), comment="요약 생성 소요 시간(초)")
    translation_time_seconds = Column(DECIMAL(10,3), comment="번역 소요 시간(초)")
    
    # 파일 메타데이터 필드
    file_size_bytes = Column(BigInteger, comment="PDF 파일 크기(바이트)")
    total_pages = Column(Integer, comment="PDF 전체 페이지 수")
    successful_pages = Column(Integer, comment="성공적으로 추출된 페이지 수")
    
    # 문서 분류 필드
    category = Column(Enum('강의', '법률안', '보고서', '기타', name='document_categories'), default='기타', nullable=False, index=True, comment="문서 카테고리 (강의, 법률안, 보고서, 기타)")
    
    # 관계 설정
    owner = relationship("User", back_populates="documents")



# ── DB 세션 의존성 ──
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

 

# ── 테이블 자동 생성 함수 ──
def init_db():
    Base.metadata.create_all(bind=engine)


# ── 유틸리티 함수들 ──
def get_user_by_username(db, username: str):
    """사용자명으로 사용자 조회"""
    return db.query(User).filter(User.username == username, User.is_active == True).first()


def get_user_by_email(db, email: str):
    """이메일로 사용자 조회"""
    return db.query(User).filter(User.email == email, User.is_active == True).first()


def get_user_documents(db, user_id: int):
    """사용자의 모든 문서 조회"""
    return db.query(PdfDocument).filter(PdfDocument.user_id == user_id).order_by(PdfDocument.created_at.desc()).all()


def can_user_access_document(db, user_id: int, document_id: int) -> bool:
    """사용자가 특정 문서에 접근 가능한지 확인"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    
    # 관리자는 모든 문서 접근 가능
    if user.role == 'admin':
        return True
    
    # 일반 사용자는 본인 문서만 접근 가능
    document = db.query(PdfDocument).filter(
        PdfDocument.id == document_id,
        PdfDocument.user_id == user_id
    ).first()
    
    return document is not None


def get_active_session(db, session_token: str):
    """활성 세션 조회"""
    from datetime import datetime
    return db.query(UserSession).filter(
        UserSession.session_token == session_token,
        UserSession.is_active == True,
        UserSession.expires_at > datetime.now()
    ).first()
