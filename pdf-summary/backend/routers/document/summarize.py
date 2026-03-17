import asyncio
import io
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
import time
import datetime
import base64
import os
from pydantic import BaseModel
from typing import Optional

from celery.result import AsyncResult
import PyPDF2

from services.pdf_service import extract_text_from_pdf
from services.ai_service import summarize_text, summarize_text_stream, categorize_document  # [변경] summarize_text_stream 추가
from services.ocr.factory import extract_with_model_sync  # [추가] OCR 동기 실행용 (run_in_executor)
from database import get_db, PdfDocument, can_user_access_document, log_admin_activity
from celery_app import celery_app
from tasks.document_tasks import extract_document_task, summarize_document_task

summarize_router = APIRouter(tags=["Summarization & Extraction"])


class ChatSummarizeRequest(BaseModel):
    document_text: str
    instruction: str
    model: str = "gemma3:latest"
    user_id: Optional[int] = None
    use_rag: bool = True
    use_lora: bool = False


@summarize_router.post("/chat-summarize")
async def chat_summarize(request: ChatSummarizeRequest):
    """사용자 지시 기반 대화형 요약 응답을 반환합니다."""
    text = (request.document_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="문서 텍스트가 비어있습니다.")

    answer = await summarize_with_instruction(
        text=text,
        instruction=request.instruction,
        model=request.model,
        user_scope=f"user_{request.user_id}" if request.user_id else "shared",
        use_rag=request.use_rag,
        use_lora=request.use_lora,
    )

    model_used = request.model
    if request.use_lora:
        model_used = os.getenv("LORA_MODEL_NAME", model_used)

    return {
        "answer": answer,
        "model_used": model_used,
        "rag_enabled": request.use_rag,
        "lora_enabled": request.use_lora,
    }


@summarize_router.post("/extract/async")
async def extract_pdf_async(
    request: Request,
    file: UploadFile = File(...),
    user_id: int = Form(...),
    ocr_model: str = Form(default="pypdf2"),
    is_important: bool = Form(default=False),
    password: str = Form(default=None),
    is_public: bool = Form(default=True),
):
    """(Queue) Extracts text asynchronously and returns a Celery task ID."""
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    encoded = base64.b64encode(file_bytes).decode("ascii")
    task = extract_document_task.apply_async(
        kwargs={
            "file_b64": encoded,
            "filename": file.filename or "uploaded_file",
            "user_id": user_id,
            "ocr_model": ocr_model,
            "is_important": is_important,
            "password": password,
            "is_public": is_public,
            "request_ip": request.client.host if request.client else "unknown",
        },
        queue="ocr",
    )

    return {
        "task_id": task.id,
        "status": "PENDING",
        "queue": "ocr",
        "message": "텍스트 추출 작업이 큐에 등록되었습니다.",
    }


@summarize_router.post("/summarize-document/async")
async def summarize_extracted_document_async(
    request: Request,
    document_id: int = Form(...),
    user_id: int = Form(...),
    model: str = Form(default="gemma3:latest"),
):
    """(Queue) Summarizes an extracted document asynchronously and returns a task ID."""
    task = summarize_document_task.apply_async(
        kwargs={
            "document_id": document_id,
            "user_id": user_id,
            "model": model,
            "request_ip": request.client.host if request.client else "unknown",
        },
        queue="llm",
    )

    return {
        "task_id": task.id,
        "status": "PENDING",
        "queue": "llm",
        "message": "문서 요약 작업이 큐에 등록되었습니다.",
    }


@summarize_router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    """Returns state/result for a queued OCR/LLM task."""
    result = AsyncResult(task_id, app=celery_app)
    response = {
        "task_id": task_id,
        "status": result.state,
    }

    if result.state == "SUCCESS":
        response["result"] = result.result
    elif result.state == "FAILURE":
        response["error"] = str(result.result)

    return response


# Helper function to create a document entry before summarization
async def _build_extraction_document(
    request: Request,
    file: UploadFile,
    user_id: int,
    ocr_model: str,
    is_important: bool,
    password: str,
    is_public: bool,
    db: Session,
):
    extraction_result = await extract_text_from_pdf(file, ocr_model=ocr_model)
    extracted_text = extraction_result["text"]
    extraction_time = extraction_result["processing_time"]

    await file.seek(0)
    file_size = len(await file.read())
    await file.seek(0)

    stored_password = None
    if is_important:
        if not password or len(password) != 4 or not password.isdigit():
            raise HTTPException(
                status_code=400,
                detail="중요문서는 4자리 숫자 비밀번호가 필요합니다."
            )
        stored_password = password
    else:
        stored_password = None

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
        is_important=is_important,
        password=stored_password,
        is_public=is_public,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    
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


@summarize_router.post("/extract")
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
    """(Step 1) PDF 텍스트 추출 진행률과 결과를 SSE로 실시간 전송합니다."""
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    filename = file.filename or "uploaded_file"
    ip_address = request.client.host if request.client else "unknown"

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def generate():
        model = (ocr_model or "pypdf2").lower()
        start_time = time.time()

        try:
            if model == "pypdf2":
                try:
                    pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))
                except Exception as exc:
                    yield _sse({"type": "error", "detail": f"PDF 형식 오류: {exc}"})
                    return

                total_pages = len(pdf_reader.pages)
                if total_pages == 0:
                    yield _sse({"type": "error", "detail": "PDF에 페이지가 없습니다."})
                    return

                yield _sse({"type": "start", "total_pages": total_pages, "ocr_mode": False})

                parts = []
                successful_pages = 0
                for page_num, page in enumerate(pdf_reader.pages, start=1):
                    try:
                        page_text = page.extract_text()
                        if page_text and page_text.strip():
                            parts.append(f"[페이지 {page_num}]\n{page_text}")
                            successful_pages += 1
                    except Exception:
                        pass

                    yield _sse({"type": "page", "page": page_num, "total": total_pages})
                    await asyncio.sleep(0)

                merged = "\n\n".join(parts).strip()
                if not merged:
                    yield _sse({
                        "type": "error",
                        "detail": "텍스트 추출 실패: 이미지 기반 문서일 수 있습니다. OCR 모델을 선택해 주세요.",
                    })
                    return

                extraction_result = {
                    "text": merged,
                    "total_pages": total_pages,
                    "successful_pages": successful_pages,
                    "processing_time": time.time() - start_time,
                    "char_count": len(merged),
                    "ocr_model": "pypdf2",
                }
            else:
                yield _sse({"type": "start", "total_pages": 0, "ocr_mode": True})

                loop = asyncio.get_running_loop()
                queue = asyncio.Queue()

                def on_page(current: int, total: int):
                    asyncio.run_coroutine_threadsafe(
                        queue.put({"type": "ocr_progress", "page": current, "total": total}),
                        loop,
                    )

                future = loop.run_in_executor(
                    None,
                    lambda: extract_with_model_sync(contents, filename, model, on_page=on_page),
                )

                while not future.done():
                    try:
                        event = queue.get_nowait()
                        yield _sse(event)
                    except asyncio.QueueEmpty:
                        await asyncio.sleep(0.08)

                while not queue.empty():
                    try:
                        yield _sse(queue.get_nowait())
                    except asyncio.QueueEmpty:
                        break

                try:
                    extraction_result = future.result()
                except Exception as exc:
                    detail = getattr(exc, "detail", str(exc))
                    yield _sse({"type": "error", "detail": detail})
                    return

            stored_password = None
            if is_important:
                password_value = str(password or "")
                if len(password_value) != 4 or not password_value.isdigit():
                    yield _sse({"type": "error", "detail": "중요문서는 4자리 숫자 비밀번호가 필요합니다."})
                    return
                stored_password = password_value

            doc = PdfDocument(
                user_id=user_id,
                filename=filename,
                extracted_text=extraction_result["text"],
                summary=None,
                ocr_model=extraction_result.get("ocr_model"),
                model_used=None,
                char_count=len(extraction_result["text"]),
                file_size_bytes=len(contents),
                total_pages=extraction_result["total_pages"],
                successful_pages=extraction_result["successful_pages"],
                extraction_time_seconds=round(extraction_result["processing_time"], 3),
                summary_time_seconds=None,
                is_important=is_important,
                password=stored_password,
                is_public=is_public,
            )
            db.add(doc)
            db.commit()
            db.refresh(doc)

            try:
                doc.category = await categorize_document(title=filename)
            except Exception:
                doc.category = "기타"
            db.commit()

            try:
                log_admin_activity(
                    db=db,
                    admin_user_id=user_id,
                    action="DOCUMENT_UPLOADED",
                    target_type="DOCUMENT",
                    target_id=doc.id,
                    details=json.dumps({
                        "filename": filename,
                        "file_size_bytes": len(contents),
                        "ocr_model": extraction_result.get("ocr_model"),
                        "category": doc.category,
                        "is_important": is_important,
                        "is_public": is_public,
                    }),
                    ip_address=ip_address,
                )
            except Exception:
                pass

            text = extraction_result["text"]
            chunk_size = 300
            chunks = [text[index:index + chunk_size] for index in range(0, len(text), chunk_size)]

            yield _sse({"type": "chunk_start", "total_chunks": len(chunks)})
            for index, chunk in enumerate(chunks, start=1):
                yield _sse({"type": "chunk", "text": chunk, "index": index, "total": len(chunks)})
                await asyncio.sleep(0)

            yield _sse({
                "type": "done",
                "id": doc.id,
                "filename": filename,
                "original_length": len(text),
                "extracted_text": text,
                "summary": None,
                "model_used": None,
                "ocr_model": extraction_result.get("ocr_model"),
                "category": doc.category,
                "created_at": datetime.datetime.now().isoformat(),
                "is_important": doc.is_important,
                "password": doc.password,
                "is_public": doc.is_public,
                "timing": {
                    "extraction_time": f"{extraction_result['processing_time']:.2f}초",
                    "summary_time": None,
                    "total_time": f"{extraction_result['processing_time']:.2f}초",
                },
                "extraction_info": {
                    "total_pages": extraction_result["total_pages"],
                    "successful_pages": extraction_result["successful_pages"],
                    "char_count": extraction_result["char_count"],
                    "file_size_mb": f"{len(contents) / (1024 * 1024):.2f}MB",
                },
            })
        except Exception as exc:
            detail = getattr(exc, "detail", str(exc))
            yield _sse({"type": "error", "detail": detail})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@summarize_router.post("/extract-chat")
async def extract_pdf_for_chat(
    file: UploadFile = File(...),
    ocr_model: str = Form(default="pypdf2"),
):
    """(Chat only) Extracts text without saving any document to DB."""
    extraction_result = await extract_text_from_pdf(file, ocr_model=ocr_model)
    extracted_text = extraction_result["text"]
    extraction_time = extraction_result["processing_time"]

    return {
        "filename": file.filename,
        "extracted_text": extracted_text,
        "ocr_model": extraction_result.get("ocr_model"),
        "timing": {
            "extraction_time": f"{extraction_time:.2f}초",
        },
        "extraction_info": {
            "total_pages": extraction_result.get("total_pages", 0),
            "successful_pages": extraction_result.get("successful_pages", 0),
            "char_count": extraction_result.get("char_count", len(extracted_text)),
        },
    }


@summarize_router.post("/summarize-document")
async def summarize_extracted_document(
    request: Request,
    document_id: int = Form(...),
    user_id: int = Form(...),
    model: str = Form(default="gemma3:latest"),
    db: Session = Depends(get_db),
):
    """(Step 2) 추출된 문서를 요약하며 토큰을 SSE로 실시간 전송합니다."""
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")

    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    if not doc.extracted_text:
        raise HTTPException(status_code=400, detail="먼저 텍스트를 추출해주세요.")

    ip_address = request.client.host if request.client else "unknown"

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def generate():
        collected = []
        summary_start = time.time()

        try:
            async for token in summarize_text_stream(doc.extracted_text, model=model):
                collected.append(token)
                yield _sse({"type": "token", "text": token})
        except Exception as exc:
            detail = getattr(exc, "detail", str(exc))
            yield _sse({"type": "error", "detail": detail})
            return

        full_summary = "".join(collected)
        summary_time = time.time() - summary_start

        doc.summary = full_summary
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
                "summary_length": len(full_summary),
            }),
            ip_address=ip_address,
        )

        yield _sse({
            "type": "done",
            "id": doc.id,
            "document_id": doc.id,
            "filename": doc.filename,
            "summary": full_summary,
            "ocr_model": doc.ocr_model,
            "model_used": doc.model_used,
            "summary_time": f"{summary_time:.2f}초",
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        })

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@summarize_router.post("/summarize")
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
    """(Legacy) Extracts and summarizes a PDF in a single call."""
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

    doc = db.query(PdfDocument).filter(PdfDocument.id == extracted["id"]).first()
    summary_start = time.time()
    summary = await summarize_text(doc.extracted_text, model=model)
    summary_time = time.time() - summary_start

    doc.summary = summary
    doc.model_used = model
    doc.summary_time_seconds = round(summary_time, 3)
    doc.updated_at = datetime.datetime.now()
    db.commit()

    extracted["summary"] = summary
    extracted["model_used"] = model
    extracted["timing"]["summary_time"] = f"{summary_time:.2f}초"
    return extracted
