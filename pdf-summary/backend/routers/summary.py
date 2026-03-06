# summary.py 전체 코드 (권한 체크 추가 + 디버깅 로그 유지)
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Body, Request  # [정재훈] 2026-03-02 추가: Body 임포트, Request 추가
from pydantic import BaseModel
from typing import Optional
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text
from urllib.parse import quote
import json
from services.pdf_service import extract_text_from_pdf, get_available_ocr_models
from services.ai_service import summarize_text, get_available_models, translate_to_english, categorize_document
from database import get_db, PdfDocument, get_user_documents, can_user_access_document , User, log_admin_activity # [정재훈 ] 2026-03-02 추가 : User
import datetime
import time

router = APIRouter()


# ────────────────────────────────────────────────────────────────
# Pydantic 모델 정의
# ────────────────────────────────────────────────────────────────
class DocumentUpdateRequest(BaseModel):
    """문서 수정 요청 스키마"""
    user_id: int
    extracted_text: Optional[str] = None
    summary: Optional[str] = None
    filename: Optional[str] = None
    is_important: bool = False
    password: Optional[str] = None


async def _build_extraction_document(
    request: Request,
    file: UploadFile = File(...),
    user_id: int = Form(...),
    ocr_model: str = Form(default="pypdf2"),
    is_important: bool = Form(default=False),
    password: str = Form(default=None),
    is_public: bool = Form(default=True),
    db: Session = Depends(get_db),
):
    # 1. PDF 텍스트 추출 (선택한 OCR 모델 사용)
    extraction_result = await extract_text_from_pdf(file, ocr_model=ocr_model)
    extracted_text = extraction_result["text"]
    extraction_time = extraction_result["processing_time"]

    # 파일 크기 계산
    await file.seek(0)
    file_size = len(await file.read())
    await file.seek(0)

    # 4. 비밀번호 검증 (중요문서인 경우)
    stored_password = None
    if is_important:
        if not password or len(password) != 4 or not password.isdigit():
            raise HTTPException(
                status_code=400,
                detail="중요문서는 4자리 숫자 비밀번호가 필요합니다."
            )
        stored_password = password
    else:
        # 중요문서가 아니면 비밀번호는 null
        stored_password = None

    # 5. DB 저장 (요약 전 단계)
    doc = PdfDocument(
        user_id=user_id,
        filename=file.filename,
        extracted_text=extracted_text,
        summary=None,
        ocr_model=extraction_result.get("ocr_model"),
        model_used=None,
        char_count=len(extracted_text),
        file_size_bytes=file_size,
        total_pages=extraction_result["total_pages"],
        successful_pages=extraction_result["successful_pages"],
        extraction_time_seconds=round(extraction_time, 3),
        summary_time_seconds=None,
        is_important=is_important,  # 중요문서 여부
        password=stored_password,  # 비밀번호 (중요문서만)
        is_public=is_public,  # 공개/비공개
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    
    # ===== [추가] 문서 카테고리 자동 분류[규호] =====
    try:
        category_start = time.time()
        category = await categorize_document(title=file.filename)
        category_time = time.time() - category_start
        
        doc.category = category
        db.commit()
        print(f"✅ 문서 카테고리 분류 완료: {category} ({category_time:.2f}초)")
    except Exception as e:
        print(f"⚠️ 카테고리 분류 실패: {str(e)}")
        doc.category = "기타"
        db.commit()
    
    # 문서 업로드 로그 기록
    log_admin_activity(
        db=db,
        admin_user_id=user_id,
        action="DOCUMENT_UPLOADED",
        target_type="DOCUMENT",
        target_id=doc.id,
        details=json.dumps({
            "filename": file.filename,
            "file_size_bytes": file_size,
            "ocr_model": extraction_result["ocr_model"],
            "category": doc.category,
            "is_important": is_important,
            "is_public": is_public
        }),
        ip_address=request.client.host
    )

    return {
        "id": doc.id,
        "filename": file.filename,
        "original_length": len(extracted_text),
        "extracted_text": extracted_text,
        "summary": None,
        "model_used": None,
        "ocr_model": extraction_result["ocr_model"],
        "category": doc.category,
        "created_at": datetime.datetime.now().isoformat(),
        "is_important": doc.is_important,
        "password": doc.password,
        "is_public": doc.is_public,
        "timing": {
            "extraction_time": f"{extraction_time:.2f}초",
            "summary_time": None,
            "total_time": f"{extraction_time:.2f}초"
        },
        "extraction_info": {
            "total_pages": extraction_result["total_pages"],
            "successful_pages": extraction_result["successful_pages"],
            "char_count": extraction_result["char_count"],
            "file_size_mb": f"{file_size / (1024*1024):.2f}MB"
        }
    }


@router.post("/extract")
async def extract_pdf(
    request: Request,
    file: UploadFile = File(...),
    user_id: int = Form(...),
    ocr_model: str = Form(default="pypdf2"),
    is_important: bool = Form(default=False),
    password: str = Form(default=None),
    is_public: bool = Form(default=True),
    db: Session = Depends(get_db),
):
    return await _build_extraction_document(
        request=request,
        file=file,
        user_id=user_id,
        ocr_model=ocr_model,
        is_important=is_important,
        password=password,
        is_public=is_public,
        db=db,
    )


@router.post("/summarize-document")
async def summarize_extracted_document(
    request: Request,
    document_id: int = Form(...),
    user_id: int = Form(...),
    model: str = Form(default="gemma3:latest"),
    db: Session = Depends(get_db),
):
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")

    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if not doc.extracted_text:
        raise HTTPException(status_code=400, detail="먼저 텍스트를 추출해주세요.")

    summary_start = time.time()
    summary = await summarize_text(doc.extracted_text, model=model)
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
        details=json.dumps({
            "filename": doc.filename,
            "llm_model": model,
            "summary_length": len(summary),
        }),
        ip_address=request.client.host,
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


@router.post("/summarize")
async def summarize_pdf_legacy(
    request: Request,
    file: UploadFile = File(...),
    user_id: int = Form(...),
    model: str = Form(default="gemma3:latest"),
    ocr_model: str = Form(default="pypdf2"),
    is_important: bool = Form(default=False),
    password: str = Form(default=None),
    is_public: bool = Form(default=True),
    db: Session = Depends(get_db),
):
    extracted = await _build_extraction_document(
        request=request,
        file=file,
        user_id=user_id,
        ocr_model=ocr_model,
        is_important=is_important,
        password=password,
        is_public=is_public,
        db=db,
    )

    summarize_result = await summarize_extracted_document(
        request=request,
        document_id=extracted["id"],
        user_id=user_id,
        model=model,
        db=db,
    )
    extracted["summary"] = summarize_result["summary"]
    extracted["model_used"] = summarize_result["model_used"]
    extracted["timing"]["summary_time"] = summarize_result["summary_time"]
    return extracted

@router.post("/translate")
async def translate_text(
    request: Request,
    document_id: int = Form(...),
    user_id: int = Form(...),
    text_type: str = Form(...),
    model: str = Form(default="gemma3:latest"),
    db: Session = Depends(get_db),
):
    """
    문서의 원문 또는 요약을 영어로 번역하고 DB에 저장합니다.
    """
    start_time = time.time()
   
    # 사용자 권한 확인
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")
   
    # 문서 조회
    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
   
    # 번역할 텍스트 결정
    if text_type == "original":
        if not doc.extracted_text:
            raise HTTPException(status_code=400, detail="원문이 없습니다.")
        text_to_translate = doc.extracted_text
        existing_translation = doc.original_translation
    elif text_type == "summary":
        if not doc.summary:
            raise HTTPException(status_code=400, detail="요약이 없습니다.")
        text_to_translate = doc.summary
        existing_translation = doc.summary_translation
    else:
        raise HTTPException(status_code=400, detail="text_type은 'original' 또는 'summary'여야 합니다.")
   
    # 이미 번역이 있고 같은 모델인 경우 기존 결과 반환
    if existing_translation and doc.translation_model == model:
        processing_time = time.time() - start_time
        return {
            "document_id": document_id,
            "text_type": text_type,
            "original_text": text_to_translate,
            "translated_text": existing_translation,
            "model_used": model,
            "processing_time": f"{processing_time:.2f}초",
            "from_cache": True,
            "original_length": len(text_to_translate),
            "translated_length": len(existing_translation)
        }
   
    try:
        # 새로 번역
        translated = await translate_to_english(text_to_translate, model)
        processing_time = time.time() - start_time
       
        # DB 업데이트
        if text_type == "original":
            doc.original_translation = translated
        else:  # summary
            doc.summary_translation = translated
           
        doc.translation_model = model
        doc.translation_time_seconds = round(processing_time, 3)
       
        db.commit()
        db.refresh(doc)
        
        # 번역 로그 기록
        log_admin_activity(
            db=db,
            admin_user_id=user_id,
            action="DOCUMENT_TRANSLATED",
            target_type="DOCUMENT",
            target_id=document_id,
            details=json.dumps({
                "text_type": text_type,
                "model": model,
                "original_length": len(text_to_translate),
                "translated_length": len(translated)
            }),
            ip_address=request.client.host
        )
       
        return {
            "document_id": document_id,
            "text_type": text_type,
            "original_text": text_to_translate,
            "translated_text": translated,
            "model_used": model,
            "processing_time": f"{processing_time:.2f}초",
            "from_cache": False,
            "original_length": len(text_to_translate),
            "translated_length": len(translated)
        }
       
    except Exception as e:
        processing_time = time.time() - start_time
        raise HTTPException(
            status_code=500,
            detail={
                "message": "번역 중 오류가 발생했습니다.",
                "error": str(e),
                "processing_time": f"{processing_time:.2f}초"
            }
        )

@router.get("/document/{document_id}")
async def get_document(
    document_id: int,
    user_id: int,  # Query parameter로 변경
    db: Session = Depends(get_db),
):
    """
    문서 ID로 전체 정보(원문, 요약, 번역 포함) 조회
    """
    # 사용자 권한 확인
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")
   
    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
       
    return {
        "id": doc.id,
        "filename": doc.filename,
        "extracted_text": doc.extracted_text,
        "summary": doc.summary,
        "original_translation": doc.original_translation,
        "summary_translation": doc.summary_translation,
        "ocr_model": doc.ocr_model,
        "model_used": doc.model_used,
        "translation_model": doc.translation_model,
        "char_count": doc.char_count,
        "file_size_bytes": doc.file_size_bytes,
        "total_pages": doc.total_pages,
        "successful_pages": doc.successful_pages,
        "extraction_time_seconds": float(doc.extraction_time_seconds) if doc.extraction_time_seconds else None,
        "summary_time_seconds": float(doc.summary_time_seconds) if doc.summary_time_seconds else None,
        "translation_time_seconds": float(doc.translation_time_seconds) if doc.translation_time_seconds else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "is_important": bool(doc.is_important),
        "password": doc.password,
        "is_public": bool(doc.is_public),
    }

@router.get("/documents/{user_id}")
async def list_user_documents(
    user_id: int,
    limit: int = 1000,
    db: Session = Depends(get_db),
):
    """
    사용자별 문서 목록 조회
    Args:
        user_id: 사용자 DB ID
        limit: 조회할 최대 문서 개수 (기본값: 1000)
    """
    from database import get_user_documents as db_get_user_documents
    documents = db_get_user_documents(db, user_id)
   
    return {
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "ocr_model": doc.ocr_model,
                "model_used": doc.model_used,
                "char_count": doc.char_count,
                "file_size_bytes": doc.file_size_bytes,
                "total_pages": doc.total_pages,
                "successful_pages": doc.successful_pages,
                "has_original_translation": bool(doc.original_translation),
                "has_summary_translation": bool(doc.summary_translation),
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "summary": doc.summary,
                "extracted_text": doc.extracted_text,
                "original_translation": doc.original_translation,
                "summary_translation": doc.summary_translation,
                # ===== [추가] 공개/비공개 및 중요 문서 필드 =====
                "is_public": bool(doc.is_public),
                "is_important": bool(doc.is_important),
            } for doc in documents[:limit]
        ],
        "total_count": len(documents),
        "page": 1,
        "total_pages": 1,
    }

@router.get("/models")
async def list_models():
    models = await get_available_models()
    return {"models": models}


@router.get("/ocr-models")
async def list_ocr_models():
    return {"ocr_models": get_available_ocr_models()}

@router.post("/download")
async def download_summary(summary: str = Form(...), filename: str = Form(default="summary")):
    content = summary.encode("utf-8")
    safe_filename = filename.replace(".pdf", "") + "_요약.txt"
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe_filename)}"
        },
    )

@router.get("/admin/database-status")
async def get_database_status(db: Session = Depends(get_db)):
    """
    데이터베이스 상태 및 통계 정보 조회
    """
    try:
        # 데이터베이스 버전 확인
        version_result = db.execute(text("SELECT VERSION()"))
        db_version = version_result.fetchone()[0]
       
        # 테이블 존재 확인
        tables_result = db.execute(text("SHOW TABLES"))
        tables = [row[0] for row in tables_result.fetchall()]
       
        # pdf_documents 테이블 구조 확인 (존재하는 경우)
        table_structure = None
        if 'pdf_documents' in tables:
            structure_result = db.execute(text("DESCRIBE pdf_documents"))
            table_structure = [
                {
                    "field": row[0],
                    "type": row[1],
                    "null": row[2],
                    "key": row[3],
                    "default": row[4],
                    "extra": row[5]
                }
                for row in structure_result.fetchall()
            ]
       
        # 데이터 통계
        data_stats = {}
        if 'pdf_documents' in tables:
            total_docs = db.query(PdfDocument).count()
           
            original_translated = db.query(PdfDocument).filter(
                PdfDocument.original_translation.isnot(None)
            ).count()
           
            summary_translated = db.query(PdfDocument).filter(
                PdfDocument.summary_translation.isnot(None)
            ).count()
           
            # 최근 문서들
            recent_docs = db.query(PdfDocument).order_by(
                PdfDocument.created_at.desc()
            ).limit(5).all()
           
            # 평균 처리 시간 (NULL이 아닌 경우만)
            avg_extraction_time = db.execute(text(
                "SELECT AVG(extraction_time_seconds) FROM pdf_documents WHERE extraction_time_seconds IS NOT NULL"
            )).scalar()
           
            avg_summary_time = db.execute(text(
                "SELECT AVG(summary_time_seconds) FROM pdf_documents WHERE summary_time_seconds IS NOT NULL"
            )).scalar()
           
            avg_translation_time = db.execute(text(
                "SELECT AVG(translation_time_seconds) FROM pdf_documents WHERE translation_time_seconds IS NOT NULL"
            )).scalar()
           
            data_stats = {
                "total_documents": total_docs,
                "original_translated": original_translated,
                "summary_translated": summary_translated,
                "translation_rate": f"{(original_translated/total_docs*100):.1f}%" if total_docs > 0 else "0%",
                "recent_documents": [
                    {
                        "id": doc.id,
                        "filename": doc.filename,
                        "created_at": doc.created_at.isoformat() if doc.created_at else None,
                        "has_original_translation": bool(doc.original_translation),
                        "has_summary_translation": bool(doc.summary_translation),
                        "char_count": doc.char_count,
                        "total_pages": doc.total_pages,
                        "file_size_mb": f"{doc.file_size_bytes / (1024*1024):.2f}" if doc.file_size_bytes else None
                    }
                    for doc in recent_docs
                ],
                "average_processing_times": {
                    "extraction_seconds": float(avg_extraction_time) if avg_extraction_time else None,
                    "summary_seconds": float(avg_summary_time) if avg_summary_time else None,
                    "translation_seconds": float(avg_translation_time) if avg_translation_time else None
                }
            }
       
        return {
            "database_connection": "✅ 연결 성공",
            "database_version": db_version,
            "tables": tables,
            "pdf_documents_table_exists": 'pdf_documents' in tables,
            "table_structure": table_structure,
            "data_statistics": data_stats,
            "timestamp": datetime.datetime.now().isoformat()
        }
       
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "데이터베이스 상태 확인 실패",
                "message": str(e)
            }
        )

# ────────────────────────────────────────────────────────────────
# [정재훈] 2026-03-02 추가: localStorage의 full_name → 실제 username 변환 엔드포인트
# ────────────────────────────────────────────────────────────────
@router.post("/admin/current-username")
async def get_current_username(
    user_id: str = Form(..., description="localStorage에 저장된 userName (full_name 또는 username)"),
    db: Session = Depends(get_db),
):
    """
    full_name으로 저장된 경우 실제 username을 반환 (401 방지용)
    """
    # 1. 먼저 username으로 조회 (이미 username인 경우 바로 성공)
    user = db.query(User).filter(User.username == user_id).first()
    if user:
        return {"username": user.username}

    # 2. full_name으로 조회 (현재 로그인 상태)
    user = db.query(User).filter(User.full_name == user_id).first()
    if user:
        return {"username": user.username}

    raise HTTPException(
        status_code=404,
        detail="사용자를 찾을 수 없습니다."
    )


# ────────────────────────────────────────────────────────────────
# DELETE 엔드포인트: 문서 삭제 (일반 사용자는 본인 문서만, 관리자는 전체)
# ────────────────────────────────────────────────────────────────
@router.delete("/summarize/{document_id}")
async def delete_document(
    document_id: int,
    request: Request,
    user_id: int = Form(...),
    db: Session = Depends(get_db),
):
    """
    문서 삭제 엔드포인트 (사용자용)
    - 관리자: 모든 문서 삭제 가능
    - 일반 사용자: 본인 문서만 삭제 가능
    """
    # 권한 확인
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서를 삭제할 권한이 없습니다.")
    
    # 문서 조회
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    
    # 문서 삭제
    db.delete(document)
    db.commit()
    
    # 관리자 활동 로그 기록
    user = db.query(User).filter(User.id == user_id).first()
    log_admin_activity(
        db=db,
        admin_user_id=user_id,
        action="DOCUMENT_DELETED",
        target_type="DOCUMENT",
        target_id=document_id,
        details=json.dumps({
            "filename": document.filename,
            "original_user_id": document.user_id,
            "deleted_by_admin": user.role == 'admin' if user else False
        }),
        ip_address=request.client.host
    )
    
    return {"message": "문서가 삭제되었습니다.", "document_id": document_id}


# ────────────────────────────────────────────────────────────────
# PUT 엔드포인트: 문서 수정 (일반 사용자는 본인 문서만, 관리자는 전체)
# ────────────────────────────────────────────────────────────────
@router.put("/summarize/{document_id}")
async def update_document(
    document_id: int,
    http_request: Request,
    request: DocumentUpdateRequest = Body(...),
    db: Session = Depends(get_db),
):
    """
    문서 수정 엔드포인트 (사용자용)
    - 관리자: 모든 문서 수정 가능
    - 일반 사용자: 본인 문서만 수정 가능
    
    요청 body format:
    {
      "user_id": 1,
      "extracted_text": "수정된 원문",
      "summary": "수정된 요약",
      "filename": "수정된파일명.pdf",
      "is_important": false,
      "password": null
    }
    """
    # 권한 확인
    if not can_user_access_document(db, request.user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서를 수정할 권한이 없습니다.")
    
    # 문서 조회
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    
    # 필드 업데이트
    if request.extracted_text is not None:
        document.extracted_text = request.extracted_text
        document.char_count = len(request.extracted_text)
    
    if request.summary is not None:
        document.summary = request.summary
    
    if request.filename is not None:
        document.filename = request.filename
    
    # 중요 문서 설정 처리
    if request.is_important:
        # 중요문서로 설정할 때
        if not request.password or len(request.password) != 4 or not request.password.isdigit():
            raise HTTPException(status_code=400, detail="중요문서는 4자리 숫자 비밀번호가 필요합니다.")
        document.is_important = True
        document.password = request.password
    else:
        # 중요문서 해제할 때
        document.is_important = False
        document.password = None
    
    document.updated_at = datetime.datetime.now()
    db.commit()
    db.refresh(document)
    
    # 관리자 활동 로그 기록
    user = db.query(User).filter(User.id == request.user_id).first()
    log_admin_activity(
        db=db,
        admin_user_id=request.user_id,
        action="DOCUMENT_UPDATED",
        target_type="DOCUMENT",
        target_id=document_id,
        details=json.dumps({
            "filename": document.filename,
            "updated_fields": [
                "extracted_text" if request.extracted_text else "",
                "summary" if request.summary else "",
                "filename" if request.filename else ""
            ],
            "updated_by_admin": user.role == 'admin' if user else False
        }),
        ip_address=http_request.client.host
    )
    
    return {
        "message": "문서가 수정되었습니다.",
        "document_id": document_id,
        "updated_at": document.updated_at.isoformat(),
        "char_count": document.char_count
    }