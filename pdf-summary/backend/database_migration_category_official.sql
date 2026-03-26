-- 기존 DB(category가 강의/법률안/보고서/기타)만 실행하세요. 순서 유지 필수.
UPDATE pdf_documents SET category = '법령·규정' WHERE category = '법률안';
UPDATE pdf_documents SET category = '보고·계획' WHERE category = '보고서';
UPDATE pdf_documents SET category = '기타' WHERE category = '강의';

ALTER TABLE pdf_documents MODIFY COLUMN category ENUM(
  '법령·규정','행정·공문','보고·계획','재정·계약','기타'
) NOT NULL DEFAULT '기타' COMMENT '문서 카테고리(공문서)';
