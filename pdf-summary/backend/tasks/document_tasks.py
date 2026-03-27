import asyncio
import base64
import datetime
import json
import time

from celery import Task
from sqlalchemy.orm import Session

from celery_app import celery_app
from database import (
    SessionLocal,
    PdfDocument,
    can_user_access_document,
    log_admin_activity,
)
from services.ai_service import summarize_text, categorize_document
from services.pdf_service import extract_text_from_pdf, _build_upload_file_from_bytes


class DBTask(Task):
    _db: Session = None

    @property
    def db(self) -> Session:
        if self._db is None:
            self._db = SessionLocal()
        return self._db

    def after_return(self, *args, **kwargs):
        if self._db is not None:
            self._db.close()
            self._db = None


@celery_app.task(bind=True, base=DBTask, name="tasks.document_tasks.extract_document_task")
def extract_document_task(
    self,
    file_b64: str,
    filename: str,
    user_id: int,
    ocr_model: str = "pypdf2",
    is_important: bool = False,
    password: str = None,
    is_public: bool = True,
    request_ip: str = "celery-worker",
):
    db = self.db
    try:
        file_bytes = base64.b64decode(file_b64)
        upload = _build_upload_file_from_bytes(file_bytes, filename)

        extraction_result = asyncio.run(extract_text_from_pdf(upload, ocr_model=ocr_model))
        extracted_text = extraction_result["text"]
        extraction_time = extraction_result["processing_time"]

        if is_important:
            if not password or len(password) != 4 or not password.isdigit():
                raise ValueError("중요문서는 4자리 숫자 비밀번호가 필요합니다.")
            stored_password = password
        else:
            stored_password = None

        doc = PdfDocument(
            user_id=user_id,
            filename=filename,
            extracted_text=extracted_text,
            summary=None,
            ocr_model=extraction_result.get("ocr_model"),
            model_used=None,
            char_count=len(extracted_text),
            file_size_bytes=len(file_bytes),
            total_pages=extraction_result.get("total_pages", 0),
            successful_pages=extraction_result.get("successful_pages", 0),
            extraction_time_seconds=round(extraction_time, 3),
            summary_time_seconds=None,
            is_important=is_important,
            password=stored_password,
            is_public=is_public,
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

        try:
            category_start = time.time()
            category = asyncio.run(categorize_document(title=filename))
            category_time = time.time() - category_start

            doc.category = category
            db.commit()
            print(f"✅ 문서 카테고리 분류 완료: {category} ({category_time:.2f}초)")
        except Exception as exc:
            print(f"⚠️ 카테고리 분류 실패: {str(exc)}")
            doc.category = "기타"
            db.commit()

        log_admin_activity(
            db=db,
            admin_user_id=user_id,
            action="DOCUMENT_UPLOADED",
            target_type="DOCUMENT",
            target_id=doc.id,
            details=json.dumps(
                {
                    "filename": filename,
                    "file_size_bytes": len(file_bytes),
                    "ocr_model": extraction_result.get("ocr_model"),
                    "category": doc.category,
                    "is_important": is_important,
                    "is_public": is_public,
                }
            ),
            ip_address=request_ip,
        )

        return {
            "id": doc.id,
            "filename": filename,
            "original_length": len(extracted_text),
            "extracted_text": extracted_text,
            "summary": None,
            "model_used": None,
            "ocr_model": extraction_result.get("ocr_model"),
            "category": doc.category,
            "created_at": datetime.datetime.now().isoformat(),
            "is_important": doc.is_important,
            "password": doc.password,
            "is_public": doc.is_public,
            "timing": {
                "extraction_time": f"{extraction_time:.2f}초",
                "summary_time": None,
                "total_time": f"{extraction_time:.2f}초",
            },
            "extraction_info": {
                "total_pages": extraction_result.get("total_pages", 0),
                "successful_pages": extraction_result.get("successful_pages", 0),
                "char_count": extraction_result.get("char_count", len(extracted_text)),
                "file_size_mb": f"{len(file_bytes) / (1024 * 1024):.2f}MB",
            },
        }
    except Exception:
        db.rollback()
        raise


@celery_app.task(bind=True, base=DBTask, name="tasks.document_tasks.summarize_document_task")
def summarize_document_task(
    self,
    document_id: int,
    user_id: int,
    model: str = "gemma3:latest",
    request_ip: str = "celery-worker",
):
    db = self.db
    try:
        if not can_user_access_document(db, user_id, document_id):
            raise ValueError("이 문서에 접근할 권한이 없습니다.")

        doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
        if not doc:
            raise ValueError("문서를 찾을 수 없습니다.")
        if not doc.extracted_text:
            raise ValueError("먼저 텍스트를 추출해주세요.")

        summary_start = time.time()
        summary = asyncio.run(summarize_text(doc.extracted_text, model=model))
        summary_time = time.time() - summary_start

        doc.summary = summary
        doc.model_used = model
        doc.summary_time_seconds = round(summary_time, 3)
        doc.updated_at = datetime.datetime.now()
        db.commit()
        db.refresh(doc)

        log_admin_activity(
            db=db,
            admin_user_id=user_id,
            action="DOCUMENT_SUMMARIZED",
            target_type="DOCUMENT",
            target_id=doc.id,
            details=json.dumps(
                {
                    "filename": doc.filename,
                    "llm_model": model,
                    "summary_length": len(summary),
                }
            ),
            ip_address=request_ip,
        )

        return {
            "id": doc.id,
            "document_id": doc.id,
            "filename": doc.filename,
            "extracted_text": doc.extracted_text,
            "summary": doc.summary,
            "ocr_model": doc.ocr_model,
            "model_used": doc.model_used,
            "summary_time": f"{summary_time:.2f}초",
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        }
    except Exception:
        db.rollback()
        raise
