from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from fastapi.responses import Response
from fastapi import Body
from sqlalchemy.orm import Session
from sqlalchemy import text
from urllib.parse import quote
from services.pdf_service import extract_text_from_pdf
from services.ai_service import summarize_text, get_available_models, translate_to_english
from database import get_db, PdfDocument, get_user_documents, can_user_access_document
import datetime
import time

router = APIRouter()


@router.post("/summarize")
async def summarize_pdf(
    file: UploadFile = File(...),
    user_id: int = Form(...),  # 사용자 ID 추가
    model: str = Form(default="gemma3:latest"),
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

    # 4. DB 저장 (확장된 필드 포함)
    doc = PdfDocument(
        user_id=user_id,  # user_id 필드 추가
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
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    overall_time = time.time() - overall_start

    return {
        "id": doc.id,
        "filename": file.filename,
        "original_length": len(extracted_text),
        "extracted_text": extracted_text,
        "summary": summary,
        "model_used": model,
        "user_id": user_id,
        "created_at": datetime.datetime.now().isoformat(),
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
    user_id: int = Form(...),  # 사용자 ID 추가
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
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
):
    """
    사용자별 문서 목록 조회 (페이지네이션 지원)

    Query params:
    - page: 1-based 페이지 번호
    - limit: 페이지당 항목 수
    """
    # call the helper imported from database.py (not this function)
    all_docs = get_user_documents(db, user_id)
    total = len(all_docs)

    # slice according to pagination
    start = (page - 1) * limit
    end = start + limit
    documents = all_docs[start:end]
    
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
                # 전체 원문과 요약을 포함하도록 추가
                "extracted_text": doc.extracted_text,
                "summary": doc.summary,
                "has_original_translation": bool(doc.original_translation),
                "has_summary_translation": bool(doc.summary_translation),
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
            } for doc in documents
        ],
        "total_count": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit,
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


@router.put("/summarize/{doc_id}")
async def update_summary(
    doc_id: int,
    user_id: int = Body(..., embed=True),  # 요청자의 ID, JSON의 {"user_id": ...}
    summary: str = Body(..., embed=True),  # 요약 텍스트
    db: Session = Depends(get_db)
):
    # 1. DB에서 해당 ID의 문서 찾기
    doc = db.query(PdfDocument).filter(PdfDocument.id == doc_id).first()
    
    if not doc:
        raise HTTPException(status_code=404, detail="해당 문서를 찾을 수 없습니다.")
    
    # --- 권한 검증 로직 ---
    if doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="본인의 문서만 수정할 수 있습니다.")

    # 2. 요약 내용 업데이트
    doc.summary = summary
    db.commit()
    db.refresh(doc)

    return {
        "id": doc.id,
        "message": "요약 내용이 성공적으로 업데이트되었습니다.",
        "summary": doc.summary
    }

@router.delete("/summarize/{doc_id}")
async def delete_summary(
    doc_id: int, 
    user_id: int = Form(...), 
    db: Session = Depends(get_db)
):
    
    doc = db.query(PdfDocument).filter(PdfDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="삭제할 문서를 찾을 수 없습니다.")
    
    # --- 권한 검증 로직 ---
    if doc.user_id != user_id:
        raise HTTPException(status_code=403, detail="본인의 문서만 삭제할 수 있습니다.")
    
    
    db.delete(doc)
    db.commit()
    return {"message": "성공적으로 삭제되었습니다."}

@router.get("/history/{user_id}")
async def get_user_history(user_id: str, db: Session = Depends(get_db)):
    # 해당 유저의 문서를 최신순으로 가져옴
    history = db.query(PdfDocument).filter(
        PdfDocument.user_id == user_id
    ).order_by(PdfDocument.id.desc()).all()
    
    return history


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


@router.get("/admin/documents")
async def list_all_documents(
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """
    모든 문서 목록 조회 (페이징)
    """
    try:
        offset = (page - 1) * limit
        
        documents = db.query(PdfDocument).order_by(
            PdfDocument.created_at.desc()
        ).offset(offset).limit(limit).all()
        
        total_count = db.query(PdfDocument).count()
        
        return {
            "documents": [
                {
                    "id": doc.id,
                    "filename": doc.filename,
                    "created_at": doc.created_at.isoformat() if doc.created_at else None,
                    "char_count": doc.char_count,
                    "model_used": doc.model_used,
                    "translation_model": doc.translation_model,
                    "has_original_translation": bool(doc.original_translation),
                    "has_summary_translation": bool(doc.summary_translation),
                    "file_size_bytes": doc.file_size_bytes,
                    "total_pages": doc.total_pages,
                    "successful_pages": doc.successful_pages,
                    "processing_times": {
                        "extraction": float(doc.extraction_time_seconds) if doc.extraction_time_seconds else None,
                        "summary": float(doc.summary_time_seconds) if doc.summary_time_seconds else None,
                        "translation": float(doc.translation_time_seconds) if doc.translation_time_seconds else None
                    }
                }
                for doc in documents
            ],
            "pagination": {
                "page": page,
                "limit": limit,
                "total_count": total_count,
                "total_pages": (total_count + limit - 1) // limit
            }
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"문서 목록 조회 실패: {str(e)}"
        )