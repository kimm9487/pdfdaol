# summary.py 전체 코드 (권한 체크 추가 + 디버깅 로그 유지)
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Body  # [정재훈] 2026-03-02 추가: Body 임포트
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload  # [재훈] 2026-03-01 추가: joinedload 임포트
from sqlalchemy import text
from urllib.parse import quote
import json
from services.pdf_service import extract_text_from_pdf
from services.ai_service import summarize_text, get_available_models, translate_to_english, categorize_document
from database import get_db, PdfDocument, get_user_documents, can_user_access_document , User, log_admin_activity # [정재훈 ] 2026-03-02 추가 : User
import datetime
import time
import io  # [정재훈] 2026-03-02 추가: CSV 생성용 io
import csv  # [정재훈] 2026-03-02 추가: CSV 작성용 csv

router = APIRouter()

@router.post("/summarize")
async def summarize_pdf(
    file: UploadFile = File(...),
    user_id: int = Form(...),
    model: str = Form(default="gemma3:latest"),
    is_important: bool = Form(default=False),  # 중요문서 여부
    password: str = Form(default=None),  # 4자리 비밀번호
    is_public: bool = Form(default=True),  # 공개 여부
    db: Session = Depends(get_db),
):
    overall_start = time.time()
   
    # 1. PDF 텍스트 추출
    extraction_start = time.time()
    try:
        extraction_result = await extract_text_from_pdf(file)
        extracted_text = extraction_result["text"]
        extraction_time = extraction_result["processing_time"]
    except Exception as e:
        raise e

    # 2. AI 요약
    summary_start = time.time()
    summary = await summarize_text(extracted_text, model=model)
    summary_time = time.time() - summary_start

    # 3. 파일 크기 계산
    file_size = len(await file.read())
    await file.seek(0)  # 파일 포인터 리셋

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

    # 5. DB 저장 (확장된 필드 포함)
    doc = PdfDocument(
        user_id=user_id,
        filename=file.filename,
        extracted_text=extracted_text,
        summary=summary,
        model_used=model,
        char_count=len(extracted_text),
        file_size_bytes=file_size,
        total_pages=extraction_result["total_pages"],
        successful_pages=extraction_result["successful_pages"],
        extraction_time_seconds=round(extraction_time, 3),
        summary_time_seconds=round(summary_time, 3),
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
        category = await categorize_document(title=file.filename, model=model)
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
            "model": model,
            "category": doc.category,
            "is_important": is_important,
            "is_public": is_public
        })
    )

    overall_time = time.time() - overall_start

    return {
        "id": doc.id,
        "filename": file.filename,
        "original_length": len(extracted_text),
        "extracted_text": extracted_text,
        "summary": summary,
        "model_used": model,
        "category": doc.category,
        "created_at": datetime.datetime.now().isoformat(),
        "is_important": doc.is_important,
        "password": doc.password,
        "is_public": doc.is_public,
        "timing": {
            "extraction_time": f"{extraction_time:.2f}초",
            "summary_time": f"{summary_time:.2f}초",
            "total_time": f"{overall_time:.2f}초"
        },
        "extraction_info": {
            "total_pages": extraction_result["total_pages"],
            "successful_pages": extraction_result["successful_pages"],
            "char_count": extraction_result["char_count"],
            "file_size_mb": f"{file_size / (1024*1024):.2f}MB"
        }
    }

@router.post("/translate")
async def translate_text(
    document_id: int = Form(...),
    user_id: int = Form(...),  # 사용자 ID 추가
    text_type: str = Form(...),  # "original" 또는 "summary"
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
            })
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
# [정재훈] 2026-03-02 추가: 선택된 문서 다운로드 엔드포인트 (CSV 형식)
# ────────────────────────────────────────────────────────────────
@router.post("/admin/download-selected")
async def download_selected_documents(
    body: dict = Body(...),
    db: Session = Depends(get_db)
):
    print("[다운로드 요청] 전체 body:", body)

    selected_ids = body.get("selected_ids", [])
    username = body.get("user_id")  # 프론트에서 보내는 그대로 받음

    print("[다운로드] 받은 selected_ids:", selected_ids)
    print("[다운로드] 받은 username:", username)

    if not selected_ids:
        raise HTTPException(status_code=400, detail="선택된 항목이 없습니다.")

    if not username:
        raise HTTPException(status_code=401, detail="사용자 ID가 필요합니다.")

    # ────────────────────────────────────────────────────────────────
    # [정재훈] 2026-03-02 임시 매핑 제거 (다른 계정 테스트 가능하게)
    # 기존 하드코딩 부분 주석 처리 또는 삭제
    # known_mapping = { ... }  ← 이 부분 주석 처리하거나 지우기
    # if username in known_mapping: ... ← 이 if 블록 전체 주석 처리
    # ────────────────────────────────────────────────────────────────

    # 현재 사용자 정보 조회 (username으로) ← 그대로 유지
    current_user = db.query(User).filter(User.username == username).first()
    if not current_user:
        raise HTTPException(status_code=401, detail="사용자가 존재하지 않습니다.")

    print("[다운로드] 조회된 사용자:", current_user.username, "ID:", current_user.id)

    # ID 리스트 안전 변환 (숫자만)
    try:
        selected_ids = [int(str(i)) for i in selected_ids if str(i).isdigit()]
    except:
        raise HTTPException(status_code=400, detail="문서 ID는 숫자 리스트여야 합니다.")

    print("[다운로드] 변환된 selected_ids:", selected_ids)

    # 본인 문서만 조회
    documents = (
        db.query(PdfDocument)
        .options(joinedload(PdfDocument.owner))
        .filter(PdfDocument.id.in_(selected_ids))
        .filter(PdfDocument.user_id == current_user.id)
        .all()
    )

    print("[다운로드] 조회된 문서 수:", len(documents))

    if not documents:
        raise HTTPException(status_code=403, detail="선택한 문서에 접근 권한이 없습니다.")
    # CSV 생성 (기존 그대로)
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow([
        "문서ID", "파일명", "생성일시", "사용자 이름", "사용자 ID (username)", 
        "사용 모델", "원문자수", "요약 내용 (최대 300자)"
    ])
    
    for doc in documents:
        writer.writerow([
            doc.id,
            doc.filename,
            doc.created_at.isoformat() if doc.created_at else "없음",
            doc.owner.full_name if doc.owner else "알수없음",
            doc.owner.username if doc.owner else "N/A",
            doc.model_used,
            doc.char_count,
            (doc.summary or "요약 내용 없음")[:300] + ("..." if doc.summary and len(doc.summary) > 300 else "")
        ])
    
    content = output.getvalue().encode("utf-8-sig")
    
    safe_filename = quote(f"{username}_선택_요약목록.csv")
    
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename*=UTF-8\'\'{safe_filename}'}
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
        })
    )
    
    return {"message": "문서가 삭제되었습니다.", "document_id": document_id}


# ────────────────────────────────────────────────────────────────
# PUT 엔드포인트: 문서 수정 (일반 사용자는 본인 문서만, 관리자는 전체)
# ────────────────────────────────────────────────────────────────
@router.put("/summarize/{document_id}")
async def update_document(
    document_id: int,
    user_id: int = Form(...),
    extracted_text: str = Form(None),
    summary: str = Form(None),
    db: Session = Depends(get_db),
):
    """
    문서 수정 엔드포인트 (사용자용)
    - 관리자: 모든 문서 수정 가능
    - 일반 사용자: 본인 문서만 수정 가능
    """
    # 권한 확인
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서를 수정할 권한이 없습니다.")
    
    # 문서 조회
    document = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    
    # 필드 업데이트
    if extracted_text is not None:
        document.extracted_text = extracted_text
        document.char_count = len(extracted_text)
    
    if summary is not None:
        document.summary = summary
    
    document.updated_at = datetime.datetime.now()
    db.commit()
    db.refresh(document)
    
    # 관리자 활동 로그 기록
    user = db.query(User).filter(User.id == user_id).first()
    log_admin_activity(
        db=db,
        admin_user_id=user_id,
        action="DOCUMENT_UPDATED",
        target_type="DOCUMENT",
        target_id=document_id,
        details=json.dumps({
            "filename": document.filename,
            "updated_fields": ["extracted_text" if extracted_text else "", "summary" if summary else ""],
            "updated_by_admin": user.role == 'admin' if user else False
        })
    )
    
    return {
        "message": "문서가 수정되었습니다.",
        "document_id": document_id,
        "updated_at": document.updated_at.isoformat(),
        "char_count": document.char_count
    }