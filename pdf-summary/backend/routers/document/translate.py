from fastapi import APIRouter, Form, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import json
import time

from services.ai_service_extract import translate_to_english_stream
from database import get_db, PdfDocument, can_user_access_document, log_admin_activity

translate_router = APIRouter(tags=["Translation"])


# [추가 2026-03-19] /translate 엔드포인트 SSE 전환
# 기존: translate_to_english() 호출 후 JSON 응답 1회 반환 (번역 완료까지 화면 변화 없음)
# 변경: StreamingResponse + SSE 방식으로 토큰을 실시간 전송
#
# SSE 이벤트 구조:
#   {"type": "token", "text": "..."}   - 번역 토큰 1개씩 전송
#   {"type": "done", "translated_text": "...", "from_cache": bool} - 완료 신호
#   {"type": "error", "detail": "..."}  - 오류 발생 시
#
# 캐시 처리:
#   동일 모델로 이미 번역된 결과가 DB에 있으면 신규 LLM 호출 없이
#   기존 텍스트를 단어 단위로 분할하여 token 이벤트로 재전송 (화면 타이핑 효과 유지)
@translate_router.post("/translate")
async def translate_text(
    request: Request,
    document_id: int = Form(...),
    user_id: int = Form(...),
    text_type: str = Form(...),
    model: str = Form(default="gemma3:latest"),
    db: Session = Depends(get_db),
):
    """번역 결과를 SSE로 실시간 스트리밍합니다."""
    if not can_user_access_document(db, user_id, document_id):
        raise HTTPException(status_code=403, detail="이 문서에 접근할 권한이 없습니다.")

    doc = db.query(PdfDocument).filter(PdfDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

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

    ip_address = request.client.host if request.client else "unknown"

    def _sse(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def generate():
        # 캐시 히트: DB에 저장된 번역 결과를 단어 단위로 쪼개 token 이벤트로 스트리밍.
        # 실제 LLM 호출 없이도 프론트엔드에서 동일한 타이핑 효과 연출 가능.
        if existing_translation and doc.translation_model == model:
            words = existing_translation.split(" ")
            for i, word in enumerate(words):
                token = word if i == 0 else " " + word
                yield _sse({"type": "token", "text": token})
            yield _sse({"type": "done", "translated_text": existing_translation, "from_cache": True})
            return

        start_time = time.time()
        collected = []
        try:
            async for token in translate_to_english_stream(text_to_translate, model=model):
                collected.append(token)
                yield _sse({"type": "token", "text": token})
        except Exception as exc:
            detail = getattr(exc, "detail", str(exc))
            yield _sse({"type": "error", "detail": detail})
            return

        full_translation = "".join(collected)
        translation_time = time.time() - start_time

        if text_type == "original":
            doc.original_translation = full_translation
        else:
            doc.summary_translation = full_translation
        doc.translation_model = model
        doc.translation_time_seconds = round(translation_time, 3)
        db.commit()
        db.refresh(doc)

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
                "translated_length": len(full_translation),
            }),
            ip_address=ip_address,
        )

        yield _sse({
            "type": "done",
            "translated_text": full_translation,
            "from_cache": False,
            "translation_time": f"{translation_time:.2f}초",
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