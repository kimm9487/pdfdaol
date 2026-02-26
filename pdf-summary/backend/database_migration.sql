
-- 1. 데이터베이스 생성 (없는 경우)
CREATE DATABASE IF NOT EXISTS pdf_summary CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pdf_summary;

-- 2. 기존 테이블이 있는 경우 컬럼 추가
ALTER TABLE pdf_documents 
  -- 번역 관련 컬럼
  ADD COLUMN IF NOT EXISTS original_translation LONGTEXT COMMENT '원문 영문 번역',
  ADD COLUMN IF NOT EXISTS summary_translation LONGTEXT COMMENT '요약 영문 번역',
  ADD COLUMN IF NOT EXISTS translation_model VARCHAR(100) COMMENT '번역에 사용된 모델',
  
  -- 처리 시간 추적 컬럼
  ADD COLUMN IF NOT EXISTS extraction_time_seconds DECIMAL(10,3) COMMENT '텍스트 추출 소요 시간(초)',
  ADD COLUMN IF NOT EXISTS summary_time_seconds DECIMAL(10,3) COMMENT '요약 생성 소요 시간(초)',
  ADD COLUMN IF NOT EXISTS translation_time_seconds DECIMAL(10,3) COMMENT '번역 소요 시간(초)',
  
  -- 파일 메타데이터 컬럼
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT COMMENT 'PDF 파일 크기(바이트)',
  ADD COLUMN IF NOT EXISTS total_pages INTEGER COMMENT 'PDF 전체 페이지 수',
  ADD COLUMN IF NOT EXISTS successful_pages INTEGER COMMENT '성공적으로 추출된 페이지 수';

-- 3. 기존 테이블이 없는 경우 새로 생성
CREATE TABLE IF NOT EXISTS pdf_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  extracted_text LONGTEXT,
  summary LONGTEXT,
  model_used VARCHAR(100),
  char_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
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
  total_pages INTEGER COMMENT 'PDF 전체 페이지 수',
  successful_pages INTEGER COMMENT '성공적으로 추출된 페이지 수',
  
  INDEX idx_filename (filename),
  INDEX idx_created_at (created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. 테이블 구조 확인
DESCRIBE pdf_documents;

-- 5. 통계 정보 확인용 쿼리들
/*
-- 전체 문서 수
SELECT COUNT(*) as total_documents FROM pdf_documents;

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
*/