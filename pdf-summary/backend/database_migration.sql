-- Active: 1771563364130@@127.0.0.1@3306@pdf_summary
-- ========================================
-- PDF 요약 서비스 데이터베이스 마이그레이션
-- ========================================

-- 1. 데이터베이스 생성 (없는 경우)
CREATE DATABASE IF NOT EXISTS pdf_summary CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pdf_summary;

-- ========================================
-- 2. 사용자 관리 테이블
-- ========================================
CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role ENUM('admin','user'),
  created_at DATETIME,
  updated_at DATETIME,
  last_login_at DATETIME,
  is_active TINYINT(1),
  provider VARCHAR(50) NOT NULL DEFAULT 'local',
  PRIMARY KEY (id),
  UNIQUE KEY ix_users_email (email),
  UNIQUE KEY ix_users_username (username),
  KEY ix_users_is_active (is_active),
  KEY ix_users_role (role),
  KEY ix_users_id (id)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DB_HOST=192.168.0.151
-- ========================================
-- 3. 사용자 세션 테이블
-- ========================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  session_token VARCHAR(255) NOT NULL,
  created_at DATETIME,
  expires_at DATETIME NOT NULL,
  is_active TINYINT(1),
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  PRIMARY KEY (id),
  UNIQUE KEY ix_user_sessions_session_token (session_token),
  KEY user_id (user_id),
  KEY ix_user_sessions_id (id),
  KEY ix_user_sessions_expires_at (expires_at),
  KEY ix_user_sessions_is_active (is_active),
  CONSTRAINT user_sessions_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- ========================================
-- 4. 관리자 활동 로그 테이블
-- ========================================
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id INT NOT NULL AUTO_INCREMENT,
  admin_user_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id INT,
  details TEXT,
  created_at DATETIME,
  ip_address VARCHAR(45),
  
  PRIMARY KEY (id),
  KEY admin_user_id (admin_user_id),
  KEY ix_admin_activity_logs_action (action),
  KEY ix_admin_activity_logs_id (id),
  KEY ix_admin_activity_logs_created_at (created_at),
  CONSTRAINT admin_activity_logs_ibfk_1 FOREIGN KEY (admin_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- ========================================
-- 5. PDF 문서 테이블
-- ========================================
CREATE TABLE IF NOT EXISTS pdf_documents (
  id INT NOT NULL AUTO_INCREMENT,
  filename VARCHAR(255) NOT NULL,
  extracted_text LONGTEXT,
  summary LONGTEXT,
  ocr_model VARCHAR(50) COMMENT '텍스트 추출에 사용된 OCR 모델',
  model_used VARCHAR(100),
  char_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  user_id INT,
  
  -- 번역 관련 필드
  original_translation LONGTEXT COMMENT '원문 영문 번역',
  summary_translation LONGTEXT COMMENT '요약 영문 번역',
  translation_model VARCHAR(100) COMMENT '번역에 사용된 모델',
  
  -- 처리 시간 추적 필드
  extraction_time_seconds DECIMAL(10,3) COMMENT '텍스트 추출 소요 시간(초)',
  summary_time_seconds DECIMAL(10,3) COMMENT '요약 생성 소요 시간(초)',
  translation_time_seconds DECIMAL(10,3) COMMENT '번역 소요 시간(초)',
  
  -- 파일 메타데이터 필드
  file_size_bytes BIGINT COMMENT 'PDF 파일 크기(바이트)',
  total_pages INT COMMENT 'PDF 전체 페이지 수',
  successful_pages INT COMMENT '성공적으로 추출된 페이지 수',
  
  -- 문서 분류 필드
  category ENUM('강의','법률안','보고서','기타') DEFAULT '기타' NOT NULL COMMENT '문서 카테고리',
  
  -- 중요 문서 및 보안 관련 필드
  is_important BOOLEAN DEFAULT FALSE COMMENT '중요문서 여부',
  password VARCHAR(4) DEFAULT NULL COMMENT '4자리 숫자 비밀번호 (중요문서만 해당)',
  is_public BOOLEAN DEFAULT TRUE COMMENT '공개 여부 (True: 공개, False: 비공개)',
  
  PRIMARY KEY (id),
  KEY ix_pdf_documents_category (category)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 5-1. 기존 테이블에 컬럼 추가 (마이그레이션)
-- ========================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider VARCHAR(50) NOT NULL DEFAULT 'local';

ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS ocr_model VARCHAR(50) COMMENT '텍스트 추출에 사용된 OCR 모델' AFTER summary;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS category ENUM('강의','법률안','보고서','기타') DEFAULT '기타' NOT NULL COMMENT '문서 카테고리' AFTER successful_pages;
ALTER TABLE pdf_documents ADD INDEX IF NOT EXISTS ix_pdf_documents_category (category);

-- 보안 관련 필드 추가
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS is_important BOOLEAN DEFAULT FALSE COMMENT '중요문서 여부' AFTER category;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS password VARCHAR(4) DEFAULT NULL COMMENT '4자리 숫자 비밀번호 (중요문서만 해당)' AFTER is_important;
ALTER TABLE pdf_documents ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE COMMENT '공개 여부 (True: 공개, False: 비공개)' AFTER password;

-- ========================================
-- 6. 통계 정보 확인용 쿼리 (필요할 때 실행)
-- ========================================
/*
-- 전체 사용자 수
SELECT COUNT(*) as total_users FROM users WHERE is_active = 1;

-- 전체 문서 수
SELECT COUNT(*) as total_documents FROM pdf_documents;

-- 사용자별 문서 수
SELECT u.username, COUNT(d.id) as document_count 
FROM users u 
LEFT JOIN pdf_documents d ON u.id = d.user_id 
GROUP BY u.id, u.username;

-- 번역 완료된 문서 수
SELECT 
  COUNT(*) as total_docs,
  COUNT(original_translation) as original_translated,
  COUNT(summary_translation) as summary_translated
FROM pdf_documents;

-- 평균 처리 시간
SELECT 
  AVG(extraction_time_seconds) as avg_extraction_time,
  AVG(summary_time_seconds) as avg_summary_time,
  AVG(translation_time_seconds) as avg_translation_time
FROM pdf_documents;

-- 파일 크기별 통계
SELECT 
  CASE 
    WHEN file_size_bytes < 1024*1024 THEN '< 1MB'
    WHEN file_size_bytes < 5*1024*1024 THEN '1-5MB' 
    WHEN file_size_bytes < 10*1024*1024 THEN '5-10MB'
    ELSE '> 10MB'
  END as file_size_range,
  COUNT(*) as count
FROM pdf_documents 
WHERE file_size_bytes IS NOT NULL
GROUP BY file_size_range;

-- 최근 활동
SELECT u.username, aal.action, aal.created_at 
FROM admin_activity_logs aal 
JOIN users u ON aal.admin_user_id = u.id 
ORDER BY aal.created_at DESC LIMIT 10;

-- 활성 세션
SELECT u.username, COUNT(us.id) as active_sessions 
FROM users u 
LEFT JOIN user_sessions us ON u.id = us.user_id AND us.is_active = 1 
GROUP BY u.id, u.username;
*/