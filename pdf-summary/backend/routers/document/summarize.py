import asyncio
import io
import re
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
# [osj | 2026-03-24] OCR 진행률 SSE 실시간 전송을 위한 동기 추출 함수 import
from services.ocr.factory import extract_with_model_sync
from services.ai_service_extract import (
    summarize_text,
    summarize_text_stream,
    categorize_document,
)
from services.ai_service_chat import (
    summarize_with_instruction,
    summarize_with_instruction_stream,
)
# [방법3 수정] SessionLocal을 직접 import하여 generate() 안에서 독립 세션 생성에 사용
from database import get_db, SessionLocal, PdfDocument, can_user_access_document, log_admin_activity
from celery_app import celery_app
from tasks.document_tasks import extract_document_task, summarize_document_task

summarize_router = APIRouter(tags=["Summarization & Extraction"])
MAX_CHAT_DOCUMENTS = 5
CHAT_DOCUMENT_PATTERN = r"^\[문서\s*\d+\s*:\s*.+?\]\s*$"
_chat_cancel_events = {}
_chat_cancel_lock = asyncio.Lock()


def _stringify_detail(detail, fallback: str = "오류가 발생했습니다.") -> str:
    if detail is None:
        return fallback
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list) and detail:
        first = detail[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return str(first.get("msg") or first.get("message") or first)
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("reason") or detail.get("suggestion") or detail)
    return str(detail)


def _build_chat_scope(user_id: Optional[int]) -> str:
    return f"user_{user_id}" if user_id else "shared"


def _count_chat_documents(document_text: str) -> int:
    matches = re.findall(CHAT_DOCUMENT_PATTERN, document_text or "", flags=re.MULTILINE)
    return len(matches)


def _validate_chat_document_limit(document_text: str):
    document_count = _count_chat_documents(document_text)
    if document_count > MAX_CHAT_DOCUMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"대화형 요약은 문서 {MAX_CHAT_DOCUMENTS}개까지만 지원합니다.",
        )


class ChatSummarizeRequest(BaseModel):
    document_text: str
    instruction: str
    model: str = "phi3:mini"
    user_id: Optional[int] = None
    use_rag: bool = True
    use_lora: bool = False
    request_id: Optional[str] = None


class ChatCancelRequest(BaseModel):
    request_id: str
    user_id: Optional[int] = None


def _chat_cancel_key(user_id: Optional[int], request_id: str) -> str:
    normalized_request_id = str(request_id or "").strip()
    normalized_user = str(user_id) if user_id is not None else "shared"
    return f"{normalized_user}:{normalized_request_id}"


@summarize_router.post("/chat-summarize")
async def chat_summarize(request: ChatSummarizeRequest):
    """사용자 지시 기반 대화형 요약 응답을 반환합니다."""
    text = (request.document_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="문서 텍스트가 비어있습니다.")
    _validate_chat_document_limit(text)

    answer = await summarize_with_instruction(
        text=text,
        instruction=request.instruction,
        model=request.model,
        user_scope=_build_chat_scope(request.user_id),
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


@summarize_router.post("/chat-summarize/stream")
async def chat_summarize_stream(request: ChatSummarizeRequest):
    """사용자 지시 기반 대화형 요약 응답을 SSE로 실시간 전송합니다."""
    text = (request.document_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="문서 텍스트가 비어있습니다.")
    _validate_chat_document_limit(text)

    model_used = request.model
    if request.use_lora:
        model_used = os.getenv("LORA_MODEL_NAME", model_used)

    request_id = str(request.request_id or "").strip()
    cancel_key = _chat_cancel_key(request.user_id, request_id) if request_id else None
    cancel_event = asyncio.Event() if cancel_key else None
    if cancel_key:
        async with _chat_cancel_lock:
            _chat_cancel_events[cancel_key] = cancel_event

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def generate():
        collected = []
        # 첫 토큰 전까지 대기 시간이 길어질 수 있어, 초기 keep-alive 이벤트를 먼저 전송합니다.
        yield _sse({"type": "start", "request_id": request_id or None})
        try:
            async for token in summarize_with_instruction_stream(
                text=text,
                instruction=request.instruction,
                model=request.model,
                user_scope=_build_chat_scope(request.user_id),
                use_rag=request.use_rag,
                use_lora=request.use_lora,
                cancel_event=cancel_event,
            ):
                if cancel_event and cancel_event.is_set():
                    yield _sse(
                        {
                            "type": "canceled",
                            "request_id": request_id,
                            "detail": "사용자 요청으로 정지",
                        }
                    )
                    return
                collected.append(token)
                yield _sse({"type": "token", "text": token})
        except asyncio.CancelledError:
            if cancel_event:
                cancel_event.set()
            raise
        except Exception as exc:
            detail = _stringify_detail(getattr(exc, "detail", str(exc)), "요약 중 오류가 발생했습니다.")
            yield _sse({"type": "error", "detail": detail})
            return
        finally:
            if cancel_key:
                async with _chat_cancel_lock:
                    _chat_cancel_events.pop(cancel_key, None)

        yield _sse(
            {
                "type": "done",
                "answer": "".join(collected),
                "model_used": model_used,
                "rag_enabled": request.use_rag,
                "lora_enabled": request.use_lora,
            }
        )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


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
    # ✅ 한 번만 읽고 bytes로 처리
    file_bytes = await file.read()
    filename = file.filename or "uploaded_file"

    extraction_result = await extract_text_from_pdf(
        file_bytes=file_bytes,
        filename=filename,
        ocr_model=ocr_model,
    )
    extracted_text = extraction_result["text"]
    extraction_time = extraction_result["processing_time"]
    file_size = len(file_bytes)

    stored_password = None
    if is_important:
        if not password or len(password) != 4 or not password.isdigit():
            raise HTTPException(
                status_code=400,
                detail="중요문서는 4자리 숫자 비밀번호가 필요합니다."
            )
        stored_password = password

    doc = PdfDocument(
        user_id=user_id,
        filename=filename,
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
        category = await categorize_document(title=filename, extracted_text=extracted_text)
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
            "filename": filename,
            "file_size_bytes": file_size,
            "ocr_model": extraction_result["ocr_model"],
            "category": doc.category,
            "is_important": is_important,
            "is_public": is_public,
        }),
        ip_address=request.client.host if request.client else "unknown",
    )

    return {
        "id": doc.id,
        "filename": filename,
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
            "total_time": f"{extraction_time:.2f}초",
        },
        "extraction_info": {
            "total_pages": extraction_result["total_pages"],
            "successful_pages": extraction_result["successful_pages"],
            "char_count": extraction_result["char_count"],
            "file_size_mb": f"{file_size / (1024 * 1024):.2f}MB",
        },
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
                # [osj | 2026-03-24] run_in_executor로 OCR을 별도 스레드에서 실행하고
                # asyncio.Queue를 통해 페이지 완료 시마다 ocr_progress SSE를 실시간 전송
                # 총 페이지 수를 먼저 파악하기 위해 PDF를 렌더링 (이미지는 OCR 단계에서 재사용)
                try:
                    from services.ocr.pdf_page_renderer import render_input_to_images as _render
                    import os as _os
                    _ext = _os.path.splitext(filename)[1].lower()
                    _preview_images = _render(contents, _ext)
                    _total = len(_preview_images)
                except Exception:
                    _total = 0

                yield _sse({"type": "start", "total_pages": _total, "ocr_mode": True})
                await asyncio.sleep(0)

                loop = asyncio.get_event_loop()
                progress_queue: asyncio.Queue = asyncio.Queue()

                def _on_page(current: int, total: int):
                    progress_queue.put_nowait({"page": current, "total": total})

                import concurrent.futures as _cf
                _executor = _cf.ThreadPoolExecutor(max_workers=1)

                ocr_future = loop.run_in_executor(
                    _executor,
                    lambda: extract_with_model_sync(
                        file_bytes=contents,
                        filename=filename,
                        ocr_model=model,
                        on_page=_on_page,
                    ),
                )

                extraction_result = None
                ocr_error = None
                while not ocr_future.done() or not progress_queue.empty():
                    try:
                        prog = progress_queue.get_nowait()
                        yield _sse({"type": "ocr_progress", "page": prog["page"], "total": prog["total"]})
                    except asyncio.QueueEmpty:
                        pass
                    await asyncio.sleep(0.05)

                try:
                    extraction_result = await ocr_future
                except Exception as exc:
                    ocr_error = exc

                # 남은 큐 비우기
                while not progress_queue.empty():
                    try:
                        prog = progress_queue.get_nowait()
                        yield _sse({"type": "ocr_progress", "page": prog["page"], "total": prog["total"]})
                    except asyncio.QueueEmpty:
                        break

                if ocr_error is not None:
                    detail = _stringify_detail(getattr(ocr_error, "detail", str(ocr_error)), "추출 중 오류가 발생했습니다.")
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
                doc.category = await categorize_document(
                    title=filename,
                    extracted_text=extraction_result["text"],
                )
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
            detail = _stringify_detail(getattr(exc, "detail", str(exc)), "추출 중 오류가 발생했습니다.")
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
    current_doc_count: int = Form(default=0),
):
    """(Chat only) Extracts text without saving any document to DB."""
    if current_doc_count >= MAX_CHAT_DOCUMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"대화형 요약은 문서 {MAX_CHAT_DOCUMENTS}개까지만 지원합니다.",
        )

    # ✅ 한 번만 읽고 bytes로 처리
    file_bytes = await file.read()
    filename = file.filename or "uploaded_file"

    extraction_result = await extract_text_from_pdf(
        file_bytes=file_bytes,
        filename=filename,
        ocr_model=ocr_model,
    )
    extracted_text = extraction_result["text"]
    extraction_time = extraction_result["processing_time"]

    return {
        "filename": filename,
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

    # [방법3 수정] SQLAlchemy 객체(doc)를 generate() 안에서 직접 참조하면
    # 외부 세션(db)이 닫힌 후 DetachedInstanceError가 발생할 수 있으므로
    # 필요한 값을 미리 일반 변수로 추출해둠
    doc_id = doc.id
    doc_extracted_text = doc.extracted_text
    doc_filename = doc.filename
    doc_ocr_model = doc.ocr_model
    doc_created_at = doc.created_at

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def generate():
        collected = []
        summary_start = time.time()

        try:
            async for token in summarize_text_stream(doc_extracted_text, model=model):
                collected.append(token)
                yield _sse({"type": "token", "text": token})
        except Exception as exc:
            detail = getattr(exc, "detail", str(exc))
            yield _sse({"type": "error", "detail": detail})
            return

        full_summary = "".join(collected)
        summary_time = time.time() - summary_start

        # [방법3 수정] Depends(get_db)로 받은 외부 세션(db) 대신
        # SessionLocal()로 독립 세션을 생성하여 DB 저장
        # → 라우터 수명주기(외부 세션 닫힘)와 무관하게 commit 보장
        # → try/finally로 세션을 반드시 닫아 커넥션 누수 방지
        independent_db = SessionLocal()
        try:
            independent_doc = independent_db.query(PdfDocument).filter(
                PdfDocument.id == doc_id
            ).first()
            if independent_doc:
                independent_doc.summary = full_summary
                independent_doc.model_used = model
                independent_doc.summary_time_seconds = round(summary_time, 3)
                independent_doc.updated_at = datetime.datetime.now()
                independent_db.commit()

                log_admin_activity(
                    db=independent_db,
                    admin_user_id=user_id,
                    action="DOCUMENT_SUMMARIZED",
                    target_type="DOCUMENT",
                    target_id=doc_id,
                    details=json.dumps({
                        "filename": doc_filename,
                        "llm_model": model,
                        "summary_length": len(full_summary),
                    }),
                    ip_address=ip_address,
                )
        finally:
            # [방법3 수정] 독립 세션은 반드시 명시적으로 닫아야 커넥션 풀 누수 없음
            independent_db.close()

        yield _sse({
            "type": "done",
            "id": doc_id,
            "document_id": doc_id,
            "filename": doc_filename,
            "summary": full_summary,
            "ocr_model": doc_ocr_model,
            "model_used": model,
            "summary_time": f"{summary_time:.2f}초",
            "created_at": doc_created_at.isoformat() if doc_created_at else None,
            "updated_at": datetime.datetime.now().isoformat(),
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