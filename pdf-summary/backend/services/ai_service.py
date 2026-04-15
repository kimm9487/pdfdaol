import os
import re
import hashlib
import json
import httpx
import asyncio
from fastapi import HTTPException
from urllib.parse import urlparse
from typing import AsyncIterator, List, Optional, Tuple

try:
    import chromadb  
except Exception:
    chromadb = None

# Ollama/VectorDB 기본 설정
_IS_DOCKER = os.path.exists("/.dockerenv")
_DEFAULT_OLLAMA_BASE_URL = "http://ollama:11434" if _IS_DOCKER else "http://127.0.0.1:11434"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", _DEFAULT_OLLAMA_BASE_URL)
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemma3:latest")
LORA_MODEL_NAME = os.getenv("LORA_MODEL_NAME", "gemma3:latest")
RAG_ENABLED = os.getenv("RAG_ENABLED", "true").strip().lower() == "true"
CHROMA_BASE_URL = os.getenv("CHROMA_BASE_URL", "http://chroma:8000")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "documents")
CHROMA_SHARED_COLLECTION = os.getenv("CHROMA_SHARED_COLLECTION", f"{CHROMA_COLLECTION}_hybrid")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
CHAT_TEMPERATURE = float(os.getenv("CHAT_TEMPERATURE", "0.1"))
CHAT_TOP_P = float(os.getenv("CHAT_TOP_P", "0.7"))
CHAT_NUM_CTX = int(os.getenv("CHAT_NUM_CTX", "4096"))
CHAT_NUM_PREDICT = int(os.getenv("CHAT_NUM_PREDICT", "800"))
CHAT_REPEAT_PENALTY = float(os.getenv("CHAT_REPEAT_PENALTY", "1.1"))
SUMMARY_MAX_CONCURRENCY = max(1, int(os.getenv("SUMMARY_MAX_CONCURRENCY", "3")))
RAG_EMBED_MAX_CONCURRENCY = max(1, int(os.getenv("RAG_EMBED_MAX_CONCURRENCY", "4")))
# 문서 입력 최대 글자 수: (num_ctx - 프롬프트 오버헤드 ~1000토큰) * 1.5 chars/token, 최소 2000자
_CHAT_INPUT_MAX_CHARS = max(2000, int((CHAT_NUM_CTX - 1000) * 1.5))
# 카테고리 분류용 본문 미리보기 길이(키워드·LLM 입력만; DB의 extracted_text 전체는 그대로 유지)
CATEGORIZE_BODY_PREFIX_CHARS = max(500, int(os.getenv("CATEGORIZE_BODY_PREFIX_CHARS", "3000")))
# 공문서 중심 카테고리 (DB Enum·프론트 필터와 동일 문자열 유지)
DOCUMENT_CATEGORY_ETC = "기타"
DOCUMENT_CATEGORIES = (
    "법령·규정",
    "행정·공문",
    "보고·계획",
    "재정·계약",
    DOCUMENT_CATEGORY_ETC,
)

SMALLTALK_PATTERNS = [
    r"^(안녕|안녕하세요|ㅎㅇ|hello|hi)\W*$",
    r"^(고마워|감사해|감사합니다|thanks|thank you)\W*$",
    r"^(이제\s*)?(물어보면|질문하면)\s*(되나|될까|돼|되나요)\W*$",
    r"^(대화|잡담)\s*(가능|돼|되나|할 수 있어)\W*$",
    r"^(미친놈이야\??|왜\s*이래\??|답답해\W*)$",
]

DOCUMENT_TASK_KEYWORDS = [
    "요약", "정리", "설명", "분석", "번역", "추출", "문서", "pdf", "핵심", "포인트", "비교", "근거", "찾아줘", "작성", "bullet",
]

DOCUMENT_FOCUS_KEYWORDS = [
    "문서", "파일", "pdf", "doc", "docx", "hwpx", "요약", "정리", "추출", "원문", "본문", "비교", "차이", "핵심", "근거",
]

COMPARE_REQUEST_KEYWORDS = [
    "비교", "차이", "다른점", "달라", "diff", "비교해", "차이점",
]

CODE_REQUEST_KEYWORDS = [
    "코드", "구현", "수정", "리팩토링", "에러", "오류", "버그", "함수", "promise.all", "javascript", "js", "python", "sql",
]


def _split_text_for_rag(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    chunks = []
    start = 0
    safe_text = (text or "").strip()
    while start < len(safe_text):
        end = min(start + chunk_size, len(safe_text))
        chunk = safe_text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(safe_text):
            break
        next_start = max(0, end - overlap)
        if next_start <= start:
            break
        start = next_start
    return chunks

def _split_text_for_summary(text: str, chunk_size: int = 1200, overlap: int = 150) -> List[str]:
    chunks = []
    start = 0
    safe_text = (text or "").strip()

    while start < len(safe_text):
        end = min(start + chunk_size, len(safe_text))
        chunk = safe_text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= len(safe_text):
            break

        next_start = max(0, end - overlap)
        if next_start <= start:
            break

        start = next_start

    return chunks


def _split_text_with_progress_guard(
    text: str,
    chunk_size: int,
    overlap: int,
    min_chunk_ratio: float = 0.5,
) -> List[str]:
    """
    경계 기반 분할 시 start가 반드시 전진하도록 강제합니다.
    """
    safe_text = text or ""
    if not safe_text:
        return []

    chunks: List[str] = []
    text_len = len(safe_text)
    start = 0
    max_iters = max(1, text_len // max(chunk_size - overlap, 1) + 5)
    iterations = 0
    min_chunk_len = max(1, int(chunk_size * min_chunk_ratio))

    while start < text_len:
        iterations += 1
        if iterations > max_iters:
            break

        raw_end = min(start + chunk_size, text_len)
        end = raw_end

        if raw_end < text_len:
            last_period = safe_text.rfind(".", start, raw_end)
            last_newline = safe_text.rfind("\n", start, raw_end)
            boundary = max(last_period, last_newline)
            if boundary >= start + min_chunk_len:
                end = boundary + 1

        if end <= start:
            end = raw_end
        if end <= start:
            break

        chunk = safe_text[start:end]
        if chunk:
            chunks.append(chunk)

        if end >= text_len:
            break

        next_start = max(0, end - overlap)
        if next_start <= start:
            next_start = min(text_len, start + min_chunk_len)
        if next_start <= start:
            break
        start = next_start

    return chunks

def _is_smalltalk_instruction(instruction: str) -> bool:
    text = (instruction or "").strip()
    if not text:
        return False

    normalized = re.sub(r"\s+", " ", text.lower())
    if any(re.match(pattern, normalized) for pattern in SMALLTALK_PATTERNS):
        return True

    has_doc_keyword = any(keyword in normalized for keyword in DOCUMENT_TASK_KEYWORDS)
    has_casual_marker = any(marker in normalized for marker in ["되나", "될까", "가능", "괜찮", "물어봐", "질문해도", "대화"])
    return (not has_doc_keyword) and has_casual_marker and len(normalized) <= 20


def _is_document_focused_instruction(instruction: str) -> bool:
    normalized = re.sub(r"\s+", " ", (instruction or "").strip().lower())
    if not normalized:
        return True
    return any(keyword in normalized for keyword in DOCUMENT_FOCUS_KEYWORDS)


def _smalltalk_response(instruction: str) -> str:
    normalized = re.sub(r"\s+", " ", (instruction or "").strip().lower())

    if any(token in normalized for token in ["안녕", "hello", "hi", "ㅎㅇ"]):
        return "안녕하세요. 편하게 말씀해 주세요."
    if any(token in normalized for token in ["고마워", "감사", "thanks", "thank you"]):
        return "천만에요. 필요한 내용만 정확히 도와드릴게요."
    if any(token in normalized for token in ["물어보면", "질문하면", "질문해도", "되나", "될까", "되나요"]):
        return "네, 이제 물어보셔도 됩니다. 원하시는 내용만 말씀해 주세요."
    if any(token in normalized for token in ["대화", "잡담"]):
        return "네, 일상대화도 가능합니다. 편하게 말씀해 주세요."
    if any(token in normalized for token in ["미친", "답답", "왜 이래"]):
        return "불편하게 느끼셨다면 죄송합니다. 요청하신 내용만 바로 답변드릴게요."
    return "네, 요청하신 내용만 간단히 답변드릴게요."


def _is_compare_request(instruction: str) -> bool:
    normalized = re.sub(r"\s+", " ", (instruction or "").strip().lower())
    if not normalized:
        return False
    return any(keyword in normalized for keyword in COMPARE_REQUEST_KEYWORDS)


def _compare_request_response() -> str:
    return (
        "현재 대화형 요약은 추출된 문서 1개 기준으로 답변하고 있습니다. "
        "두 파일 비교를 원하시면 두 문서의 텍스트를 함께 제공하거나, 비교할 두 파일을 모두 업로드해 주세요."
    )


def _is_code_request(instruction: str) -> bool:
    normalized = re.sub(r"\s+", " ", (instruction or "").strip().lower())
    if not normalized:
        return False
    return any(keyword in normalized for keyword in CODE_REQUEST_KEYWORDS)


def _extract_document_names(text: str) -> List[str]:
    matches = re.findall(r"^\[문서\s*\d+\s*:\s*(.+?)\]\s*$", text or "", flags=re.MULTILINE)
    return [name.strip() for name in matches if name.strip()]


def _build_chat_prompts(
    *,
    clean_instruction: str,
    text: str,
    rag_block: str,
    is_document_focused: bool,
) -> Tuple[str, str]:
    if is_document_focused:
        is_code_intent = _is_code_request(clean_instruction)
        document_names = _extract_document_names(text)
        document_count = len(document_names)
        has_per_document_intent = any(
            token in clean_instruction for token in ["각각", "문서별", "각 문서", "하나씩", "파일별", "두줄씩", "두 줄씩"]
        )

        if is_code_intent:
            system_prompt = '''[ROLE]
너는 문서 근거 기반 코드 도우미다.

[TASK]
사용자 요청이 코드 수정/구현이면 문서에서 관련 근거를 찾고, 필요한 코드만 정확히 제시하라.

[STRICT RULES]
- 문서에 없는 내용은 절대 단정하지 말 것
- 추측 금지
- 근거가 부족하면 "정보 없음"을 포함해 답할 것
- 한국어는 반드시 자연스러운 존댓말로 작성할 것
- 같은 문장을 반복하거나 어색한 번역투 문장을 만들지 말 것

[FORMAT]
- 변경 요점 bullet 2~4개
- 필요 시 수정 코드 블록 1개
- 마지막 줄: "요약: ..."'''

            user_prompt = f'''[INPUT]
문서:
"""
{text}
{rag_block}
"""

요청:
{clean_instruction}

출력 시 문서의 서로 다른 언어 코드가 섞여 있더라도, 요청과 직접 관련된 코드만 정리해서 제시하세요.'''
            return system_prompt, user_prompt

        system_prompt = '''[ROLE]
    너는 문서 기반 질문응답 시스템이다.

    [TASK]
    사용자 질문에 대해 반드시 문서 근거만 사용해 답하라.

    [STRICT RULES]
    - 모든 출력은 반드시 한국어로 작성할 것
    - 한국어 문장은 자연스러운 존댓말로 작성할 것
    - 문서 제목이나 목차를 그대로 베끼지 말고, 완결된 문장으로 요약할 것
    - 같은 문장을 반복하거나 어색한 번역투 문장을 쓰지 말 것
    - 문서에 없는 내용은 절대 생성하지 말 것
    - 추측 금지
    - 정보가 부족하면 반드시 "정보 없음"이라고 쓸 것
    - 사용자가 요구한 형식이 있으면 그 형식을 최우선으로 따를 것
    - 답변 중간에 끊긴 듯한 미완성 제목이나 단어만 남기지 말 것

    [FORMAT RULES]
    - 사용자가 "각각", "문서별", "각 문서", "두줄씩"처럼 문서별 정리를 요구하면 문서별로 분리해서 답할 것
    - 문서별 응답 시 각 문서는 최대 2문장 또는 사용자가 요청한 줄 수만 사용할 것
    - 마지막 문장은 항상 완결된 한국어 문장으로 끝낼 것'''

        document_summary_hint = ""
        if document_count > 1:
            document_summary_hint = "\n문서 목록:\n" + "\n".join(
            f"- 문서 {index + 1}: {name}" for index, name in enumerate(document_names)
            )

        per_document_hint = ""
        if document_count > 1 and has_per_document_intent:
            per_document_hint = (
            "\n출력 형식 지침:\n"
            "- 문서별로 '문서 n - 파일명' 형식의 짧은 소제목을 붙이세요.\n"
            "- 각 문서마다 요청한 분량만큼만 핵심 내용을 쓰세요.\n"
            "- 문서 원문의 소제목만 단독으로 복사하지 마세요."
            )

        user_prompt = f'''[INPUT]
    문서:
    """
    {text}
    {rag_block}
    """{document_summary_hint}{per_document_hint}

    질문:
    {clean_instruction}'''
        return system_prompt, user_prompt

    system_prompt = """당신은 한국어로 대화하는 친절한 AI 어시스턴트입니다.

[규칙]
- 요청이 명확하면 즉시 답변하세요.
- 사용자의 문장을 반복하거나 불필요하게 되묻지 마세요.
- 요청하지 않은 장황한 설명은 생략하고 1~4문장으로 간결하게 답하세요.
- 자연스러운 한국어 존댓말로 답변하세요.
- 무조건 한국어로 답변하세요."""
    user_prompt = clean_instruction
    return system_prompt, user_prompt


def _sanitize_collection_suffix(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]", "_", (value or "shared").strip())
    return normalized[:48] or "shared"


def _extract_owner_id_from_scope(scope: str) -> Optional[str]:
    normalized_scope = (scope or "").strip()
    match = re.match(r"^user_(\d+)_", normalized_scope)
    if not match:
        return None
    return match.group(1)


def _resolve_visibility_from_scope(scope: str) -> str:
    normalized_scope = (scope or "").strip().lower()
    if normalized_scope.startswith("shared_") or normalized_scope == "shared":
        return "public"
    return "private"


def _build_hybrid_where(owner_id: Optional[str]) -> dict:
    if owner_id:
        return {"$or": [{"visibility": "public"}, {"owner_id": owner_id}]}
    return {"visibility": "public"}


def _get_chroma_http_client():
    if chromadb is None:
        return None

    parsed = urlparse(CHROMA_BASE_URL)
    host = parsed.hostname or "chroma"
    if parsed.port:
        port = parsed.port
    else:
        port = 443 if parsed.scheme == "https" else 8000
    ssl = parsed.scheme == "https"
    return chromadb.HttpClient(host=host, port=port, ssl=ssl)


async def _persist_chat_exchange_chunks(
    *,
    user_scope: str,
    user_query: str,
    assistant_answer: str,
    model: str,
) -> None:
    """사용자 질의/LLM 응답을 청크로 분할해 하이브리드 컬렉션에 저장합니다."""
    query_text = (user_query or "").strip()
    answer_text = (assistant_answer or "").strip()
    if not query_text and not answer_text:
        return

    chroma_client = _get_chroma_http_client()
    if chroma_client is None:
        return

    scope = _sanitize_collection_suffix(user_scope)
    owner_id = _extract_owner_id_from_scope(scope)
    visibility = _resolve_visibility_from_scope(scope)
    collection_name = _sanitize_collection_suffix(CHROMA_SHARED_COLLECTION)

    try:
        collection = chroma_client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
    except Exception as exc:
        print(f"⚠️ Chat 컬렉션 접근 실패: {str(exc)}")
        return

    transcript = (
        f"[USER_QUERY]\n{query_text}\n\n"
        f"[ASSISTANT_ANSWER]\n{answer_text}\n\n"
        f"[MODEL]\n{(model or DEFAULT_MODEL).strip()}"
    ).strip()

    chunks = _split_text_for_rag(transcript, chunk_size=600, overlap=80)
    if not chunks:
        return

    fingerprint = hashlib.sha1(transcript[:4000].encode("utf-8", errors="ignore")).hexdigest()[:12]
    ids = []
    documents = []
    embeddings = []
    metadatas = []

    semaphore = asyncio.Semaphore(RAG_EMBED_MAX_CONCURRENCY)

    async def _embed_chunk(idx: int, chunk: str):
        async with semaphore:
            emb = await _get_ollama_embedding(chunk)
            return idx, chunk, emb

    embed_tasks = [_embed_chunk(idx, chunk) for idx, chunk in enumerate(chunks)]
    embed_results = await asyncio.gather(*embed_tasks)

    for idx, chunk, emb in sorted(embed_results, key=lambda item: item[0]):
        if emb is None:
            continue
        ids.append(f"chat-{fingerprint}-{idx}")
        documents.append(chunk)
        embeddings.append(emb)
        metadatas.append(
            {
                "scope": scope,
                "chunk_index": idx,
                "owner_id": owner_id or "global",
                "visibility": visibility,
                "doc_fingerprint": fingerprint,
                "source": "chat_history",
            }
        )

    if not ids:
        return

    try:
        existing = collection.get(ids=[f"chat-{fingerprint}-0"])
        if not existing.get("ids"):
            collection.upsert(
                ids=ids,
                documents=documents,
                embeddings=embeddings,
                metadatas=metadatas,
            )
    except Exception as exc:
        print(f"⚠️ Chat 청크 저장 실패: {str(exc)}")


async def _get_ollama_embedding(text: str, model: str = EMBEDDING_MODEL) -> Optional[List[float]]:
    input_text = (text or "").strip()
    if not input_text:
        return None

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            legacy_response = await client.post(
                f"{OLLAMA_BASE_URL}/api/embeddings",
                json={"model": model, "prompt": input_text},
            )
            if legacy_response.status_code == 200:
                payload = legacy_response.json()
                return payload.get("embedding")

            embed_response = await client.post(
                f"{OLLAMA_BASE_URL}/api/embed",
                json={"model": model, "input": input_text},
            )
            if embed_response.status_code == 200:
                payload = embed_response.json()
                embeddings = payload.get("embeddings") or []
                if embeddings:
                    return embeddings[0]
    except Exception as exc:
        print(f"⚠️ 임베딩 생성 실패: {str(exc)}")

    return None


async def build_rag_context(document_text: str, query: str, user_scope: str, top_k: int = RAG_TOP_K) -> Tuple[str, int]:
    if not RAG_ENABLED:
        return "", 0

    text = (document_text or "").strip()
    if not text:
        return "", 0

    chroma_client = _get_chroma_http_client()
    if chroma_client is None:
        return "", 0

    chunks = _split_text_for_rag(text)
    if not chunks:
        return "", 0

    scope = _sanitize_collection_suffix(user_scope)
    owner_id = _extract_owner_id_from_scope(scope)
    visibility = _resolve_visibility_from_scope(scope)
    collection_name = _sanitize_collection_suffix(CHROMA_SHARED_COLLECTION)
    try:
        collection = chroma_client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
    except Exception as exc:
        print(f"⚠️ Chroma 컬렉션 생성 실패: {str(exc)}")
        return "", 0

    fingerprint = hashlib.sha1(text[:4000].encode("utf-8", errors="ignore")).hexdigest()[:12]
    ids = []
    documents = []
    embeddings = []
    metadatas = []

    semaphore = asyncio.Semaphore(RAG_EMBED_MAX_CONCURRENCY)

    async def _embed_chunk(idx: int, chunk: str):
        async with semaphore:
            emb = await _get_ollama_embedding(chunk)
            return idx, chunk, emb

    embed_tasks = [_embed_chunk(idx, chunk) for idx, chunk in enumerate(chunks)]
    embed_results = await asyncio.gather(*embed_tasks)

    for idx, chunk, emb in sorted(embed_results, key=lambda item: item[0]):
        if emb is None:
            continue
        ids.append(f"{fingerprint}-{idx}")
        documents.append(chunk)
        embeddings.append(emb)
        metadatas.append(
            {
                "scope": scope,
                "chunk_index": idx,
                "owner_id": owner_id or "global",
                "visibility": visibility,
                "doc_fingerprint": fingerprint,
            }
        )

    if not ids:
        # 임베딩 실패 시 최소한 앞부분 문맥 제공
        fallback_docs = chunks[:top_k]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    # 🔥 이미 저장된 문서인지 확인 (fingerprint 기반)
    try:
        existing = collection.get(ids=[f"{fingerprint}-0"])
        if not existing["ids"]:
            try:
                collection.upsert(
                    ids=ids,
                    documents=documents,
                    embeddings=embeddings,
                    metadatas=metadatas
                )
            except Exception as exc:
                print(f"⚠️ Chroma 처리 실패: {str(exc)}")
                fallback_docs = chunks[:top_k]
                return "\n\n".join(
                    f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)
                ), len(fallback_docs)
    except Exception as exc:
        print(f"⚠️ Chroma 처리 실패: {str(exc)}")
        fallback_docs = chunks[:top_k]
        return "\n\n".join(
            f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)
        ), len(fallback_docs)

    query_emb = await _get_ollama_embedding(query)
    if query_emb is None:
        fallback_docs = chunks[:top_k]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    try:
        where_filter = _build_hybrid_where(owner_id)
        results = collection.query(
            query_embeddings=[query_emb],
            n_results=min(max(top_k, 1), len(ids)),
            where=where_filter,
            include=["documents", "distances"],
        )
        doc_hits = (results.get("documents") or [[]])[0]
    except Exception as exc:
        print(f"⚠️ Chroma query 실패: {str(exc)}")
        doc_hits = []

    if not doc_hits:
        fallback_docs = chunks[:top_k]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    context = "\n\n".join(f"[문맥 {i+1}] {chunk}" for i, chunk in enumerate(doc_hits))
    return context, len(doc_hits)

async def summarize_long_text(text: str, model: str) -> str:
    """
    긴 문서를 청크 단위로 나누어 요약 (map-reduce 방식)
    """

    chunks = _split_text_for_summary(text)
    if not chunks:
        return ""

    semaphore = asyncio.Semaphore(SUMMARY_MAX_CONCURRENCY)

    async def _summarize_chunk(chunk: str) -> str:
        async with semaphore:
            return await summarize_text(chunk, model)

    tasks = [_summarize_chunk(chunk) for chunk in chunks]
    partial_summaries = await asyncio.gather(*tasks)

    combined = "\n".join(partial_summaries)

    final_summary = await summarize_text(combined, model)

    return final_summary

async def summarize_text(text: str, model: str = DEFAULT_MODEL) -> str:
    MAX_CHARS = 8000

    # 🔥 기존 cut 제거 → 청크 기반 요약으로 변경
    if len(text) > MAX_CHARS:
        return await summarize_long_text(text, model)

    prompt = f"""다음 PDF 문서 내용을 한국어로 명확하고 간결하게 요약해줘.

요약 형식:
1. 전체 내용을 3~5문장으로 핵심 요약
2. 주요 키워드 5개 이하
3. 중요 포인트 3~5가지 (bullet point)

--- 문서 내용 ---
{text}
---

위 내용을 위 형식에 맞게 요약해줘."""

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "options": {
                        "temperature": CHAT_TEMPERATURE,
                        "top_p": CHAT_TOP_P,
                    },
                    "stream": False,
                }   
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Ollama API 오류: {response.status_code} - 모델({model})이 설치되어 있는지 확인하세요."
                )

            data = response.json()
            return data.get("response", "요약 결과를 가져올 수 없습니다.")

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama 서버에 연결할 수 없습니다. 서버 주소(OLLAMA_BASE_URL) 또는 컨테이너 상태를 확인해주세요."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 요약 중 오류 발생: {str(e)}")


async def summarize_text_stream(text: str, model: str = DEFAULT_MODEL) -> AsyncIterator[str]:
    """Ollama 스트리밍 응답을 토큰 단위 문자열로 반환합니다."""
    MAX_CHARS = 8000
    if len(text) > MAX_CHARS:
        result = await summarize_long_text(text, model)
        yield result
        return

    prompt = f"""다음 PDF 문서 내용을 한국어로 명확하고 간결하게 요약해줘.

요약 형식:
1. 전체 내용을 3~5문장으로 핵심 요약
2. 주요 키워드 5개 이하
3. 중요 포인트 3~5가지 (bullet point)

--- 문서 내용 ---
{text}
---

위 내용을 위 형식에 맞게 요약해줘."""

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": True,
                    # [속도 최적화 2026-03-19] 컨텍스트 크기 축소 + 최대 토큰 제한 → LLM 추론 속도 향상
                    "num_ctx": 4096,       # 기본값 ~8192보다 작게 설정
                    "num_predict": 1024,  # 요약 출력 토큰 상한
                    "repeat_penalty": 1.1, # 반복 패널티 줄여 속도 향상
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    detail = body.decode("utf-8", errors="ignore")
                    raise HTTPException(
                        status_code=502,
                        detail=f"Ollama API 오류: {response.status_code} - 모델({model})이 설치되어 있는지 확인하세요. {detail}".strip(),
                    )

                async for line in response.aiter_lines():
                    if not line:
                        continue

                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    chunk = payload.get("response", "")
                    if chunk:
                        yield chunk

                    if payload.get("done"):
                        break

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama 서버에 연결할 수 없습니다. 서버 주소(OLLAMA_BASE_URL) 또는 컨테이너 상태를 확인해주세요.",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 스트리밍 요약 중 오류 발생: {str(e)}")


async def summarize_with_instruction(
    text: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
    user_scope: str = "shared",
    use_rag: bool = True,
    use_lora: bool = False,
) -> str:
    """사용자 지시를 반영해 문서 텍스트를 요약/정리합니다."""
    MAX_CHARS = _CHAT_INPUT_MAX_CHARS
    if len(text) > MAX_CHARS:
        text = await summarize_long_text(text, model)

    clean_instruction = (instruction or "핵심 내용을 짧게 요약해줘").strip()
    if not clean_instruction:
        clean_instruction = "핵심 내용을 짧게 요약해줘"

    if _is_smalltalk_instruction(clean_instruction):
        return _smalltalk_response(clean_instruction)

    is_document_focused = _is_document_focused_instruction(clean_instruction)

    selected_model = LORA_MODEL_NAME if use_lora else model
    if not selected_model:
        selected_model = DEFAULT_MODEL

    rag_context = ""
    rag_count = 0
    if use_rag and (is_document_focused or _is_code_request(clean_instruction)):
        rag_context, rag_count = await build_rag_context(
            document_text=text,
            query=clean_instruction,
            user_scope=user_scope,
        )

    rag_block = ""
    if rag_context:
        rag_block = f"""
[검색 문맥(RAG)]
아래 문맥을 우선 참고해 답변하세요.
{rag_context}
"""

    system_prompt, user_prompt = _build_chat_prompts(
        clean_instruction=clean_instruction,
        text=text,
        rag_block=rag_block,
        is_document_focused=is_document_focused,
    )

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": selected_model,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "options": {
                        "temperature": CHAT_TEMPERATURE,
                        "top_p": CHAT_TOP_P,
                        "num_ctx": CHAT_NUM_CTX,
                        "num_predict": CHAT_NUM_PREDICT,
                        "repeat_penalty": CHAT_REPEAT_PENALTY,
                    },
                    "stream": False,
                },
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Ollama API 오류: {response.status_code} - 모델({selected_model})이 설치되어 있는지 확인하세요.",
                )

            data = response.json()
            answer = data.get("response", "응답을 가져올 수 없습니다.")
            try:
                await _persist_chat_exchange_chunks(
                    user_scope=user_scope,
                    user_query=clean_instruction,
                    assistant_answer=answer,
                    model=selected_model,
                )
            except Exception as exc:
                print(f"⚠️ Chat 이력 저장 실패: {str(exc)}")
            return answer

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama 서버에 연결할 수 없습니다. 서버 주소(OLLAMA_BASE_URL) 또는 컨테이너 상태를 확인해주세요.",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"대화형 요약 중 오류 발생: {str(e)}")


async def summarize_with_instruction_stream(
    text: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
    user_scope: str = "shared",
    use_rag: bool = True,
    use_lora: bool = False,
    cancel_event: Optional[asyncio.Event] = None,
) -> AsyncIterator[str]:
    """사용자 지시 기반 대화형 요약을 토큰 스트리밍으로 반환합니다."""
    MAX_CHARS = _CHAT_INPUT_MAX_CHARS
    if len(text) > MAX_CHARS:
        text = await summarize_long_text(text, model)

    clean_instruction = (instruction or "핵심 내용을 짧게 요약해줘").strip()
    if not clean_instruction:
        clean_instruction = "핵심 내용을 짧게 요약해줘"

    if _is_smalltalk_instruction(clean_instruction):
        yield _smalltalk_response(clean_instruction)
        return

    is_document_focused = _is_document_focused_instruction(clean_instruction)

    selected_model = LORA_MODEL_NAME if use_lora else model
    if not selected_model:
        selected_model = DEFAULT_MODEL

    rag_context = ""
    rag_count = 0
    if use_rag and (is_document_focused or _is_code_request(clean_instruction)):
        rag_context, rag_count = await build_rag_context(
            document_text=text,
            query=clean_instruction,
            user_scope=user_scope,
        )

    rag_block = ""
    if rag_context:
        rag_block = f"""
[검색 문맥(RAG)]
아래 문맥을 우선 참고해 답변하세요.
{rag_context}
"""

    system_prompt, user_prompt = _build_chat_prompts(
        clean_instruction=clean_instruction,
        text=text,
        rag_block=rag_block,
        is_document_focused=is_document_focused,
    )

    try:
        streamed_chunks: List[str] = []
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": selected_model,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "options": {
                        "temperature": CHAT_TEMPERATURE,
                        "top_p": CHAT_TOP_P,
                        "num_ctx": CHAT_NUM_CTX,
                        "num_predict": CHAT_NUM_PREDICT,
                        "repeat_penalty": CHAT_REPEAT_PENALTY,
                    },
                    "stream": True,
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    detail = body.decode("utf-8", errors="ignore")
                    raise HTTPException(
                        status_code=502,
                        detail=f"Ollama API 오류: {response.status_code} - 모델({selected_model})이 설치되어 있는지 확인하세요. {detail}".strip(),
                    )

                async for line in response.aiter_lines():
                    if cancel_event and cancel_event.is_set():
                        break

                    if not line:
                        continue

                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    chunk = payload.get("response", "")
                    if chunk:
                        streamed_chunks.append(chunk)
                        yield chunk

                    if payload.get("done"):
                        break

        try:
            await _persist_chat_exchange_chunks(
                user_scope=user_scope,
                user_query=clean_instruction,
                assistant_answer="".join(streamed_chunks),
                model=selected_model,
            )
        except Exception as exc:
            print(f"⚠️ Chat 이력 저장 실패: {str(exc)}")

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama 서버에 연결할 수 없습니다. 서버 주소(OLLAMA_BASE_URL) 또는 컨테이너 상태를 확인해주세요.",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"대화형 스트리밍 요약 중 오류 발생: {str(e)}")


async def translate_to_english(text: str, model: str = DEFAULT_MODEL) -> str:
    """
    한국어 텍스트를 영어로 번역합니다.
    """
    MAX_CHARS = 6000
    if len(text) > MAX_CHARS:
        # 긴 텍스트는 청킹해서 번역
        return await _translate_long_text(text, model)
    
    prompt = f"""다음 한국어 텍스트를 자연스러운 영어로 번역해주세요. 
전문용어는 적절히 유지하고, 문맥과 의미를 정확히 전달해주세요.

한국어 텍스트:
{text}

영어 번역:"""

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                },
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"번역 API 오류: {response.status_code} - 모델({model})이 설치되어 있는지 확인하세요."
                )

            data = response.json()
            return data.get("response", "번역 결과를 가져올 수 없습니다.")

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama 서버에 연결할 수 없습니다. 서버 주소(OLLAMA_BASE_URL) 또는 컨테이너 상태를 확인해주세요."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"번역 중 오류 발생: {str(e)}")


async def _translate_long_text(text: str, model: str) -> str:
    """
    긴 텍스트를 청킹해서 번역하고 결합합니다.
    """
    CHUNK_SIZE = 4000
    OVERLAP = 200

    chunks = _split_text_with_progress_guard(
        text=text,
        chunk_size=CHUNK_SIZE,
        overlap=OVERLAP,
        min_chunk_ratio=0.5,
    )

    if not chunks and text:
        chunks = [text]
    
    translated_chunks = []
    for i, chunk in enumerate(chunks):
        try:
            translated = await translate_to_english(chunk, model)
            translated_chunks.append(translated)
        except Exception as e:
            translated_chunks.append(f"[번역 실패 구간 {i+1}: {str(e)}]")
    
    return "\n\n".join(translated_chunks)


# [추가 2026-03-19] translate_to_english_stream / _stream_translate_chunk
# 기존 translate_to_english()는 응답이 완전히 완성된 후 한 번에 반환(non-streaming)했음.
# 번역도 요약처럼 실시간 타이핑 효과를 주기 위해 Ollama stream:True 방식으로 교체.
#
# - translate_to_english_stream(): 진입점. 텍스트가 6000자 초과 시 4000자 청크로 분할하여
#   청크별로 _stream_translate_chunk()를 호출하고, 청크 사이에 "\n\n" 구분자를 yield.
#   6000자 이하면 바로 _stream_translate_chunk() 호출.
# - _stream_translate_chunk(): Ollama /api/generate에 stream:True로 POST.
#   응답 라인을 JSON 파싱하여 response 필드(토큰)를 하나씩 yield.
#   done:true가 오면 루프 종료.
async def translate_to_english_stream(text: str, model: str = DEFAULT_MODEL) -> AsyncIterator[str]:
    """한국어 텍스트를 영어로 번역하며 토큰을 스트리밍합니다."""
    MAX_CHARS = 6000
    if len(text) > MAX_CHARS:
        CHUNK_SIZE = 4000
        OVERLAP = 200
        chunks = _split_text_with_progress_guard(
            text=text,
            chunk_size=CHUNK_SIZE,
            overlap=OVERLAP,
            min_chunk_ratio=0.5,
        )
        if not chunks:
            chunks = [text]
        for i, chunk in enumerate(chunks):
            if i > 0:
                yield "\n\n"
            async for token in _stream_translate_chunk(chunk, model):
                yield token
        return
    async for token in _stream_translate_chunk(text, model):
        yield token


async def _stream_translate_chunk(text: str, model: str) -> AsyncIterator[str]:
    """단일 청크를 번역하며 토큰 스트리밍합니다. Ollama stream:True 사용."""
    prompt = f"""다음 한국어 텍스트를 자연스러운 영어로 번역해주세요.
전문용어는 적절히 유지하고, 문맥과 의미를 정확히 전달해주세요.

한국어 텍스트:
{text}

영어 번역:"""

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model, "prompt": prompt, "stream": True,
                    # [속도 최적화 2026-03-19] 번역은 요약보다 컨텍스트가 짧으므로 num_ctx 조절
                    "num_ctx": 3072,
                    "num_predict": 1500,
                    "repeat_penalty": 1.1,
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    raise HTTPException(status_code=502, detail=f"번역 API 오류: {response.status_code}")
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    chunk = payload.get("response", "")
                    if chunk:
                        yield chunk
                    if payload.get("done"):
                        break
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Ollama 서버에 연결할 수 없습니다.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"번역 스트리밍 중 오류 발생: {str(e)}")


# LLM 선택 드롭다운에서 제외할 임베딩 전용 모델 키워드
_EMBEDDING_MODEL_KEYWORDS = (
    "embed",
    "embedding",
    "nomic",
    "all-minilm",
    "bge-",
    "e5-",
    "gte-",
)


def _is_embedding_model(name: str) -> bool:
    lower = name.lower()
    return any(kw in lower for kw in _EMBEDDING_MODEL_KEYWORDS)


async def get_available_models() -> list:
    """
    Ollama에 설치된 모델 목록 중 LLM(생성 모델)만 반환합니다.
    임베딩 전용 모델(nomic-embed-text 등)은 제외됩니다.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                data = response.json()
                return [
                    m["name"]
                    for m in data.get("models", [])
                    if not _is_embedding_model(m["name"])
                ]
            return []
    except Exception:
        return []


async def _categorize_with_llm(
    title: str,
    body_excerpt: str,
    model: str,
    fallback_category: str,
) -> str:
    """제목·본문 앞부분 기반 LLM 분류. 키워드 폴백이 모두 기타일 때만 호출됩니다."""
    valid_categories = list(DOCUMENT_CATEGORIES)
    definitions = """카테고리 정의:
1. 법령·규정: 법률·시행령·시행규칙·훈령·예규·행정규칙·조례·고시(법규)·법안·의안·조항·개정·제정 등 규범 문서
2. 행정·공문: 공문·시달·협조요청·회신·통지·결재·품의·유통·대외 행정 안내·기관 간 문서
3. 보고·계획: 업무보고·검토보고·실적·현황·통계·분석·평가·사업계획·추진계획·연간·월간·분기 보고
4. 재정·계약: 예산·결산·입찰·계약·낙찰·지출·집행·용역·구매·발주·회계 등 재무·조달
5. 기타: 위 네 가지에 명확히 해당하지 않는 경우"""
    cat_line = "카테고리: [" + " 또는 ".join(valid_categories) + "]"

    if body_excerpt.strip():
        prompt = f"""다음 문서의 제목과 본문 앞부분을 함께 참고하여 정확히 하나의 카테고리로 분류해줘.

{definitions}

문서 제목:
---
{title}
---

본문 앞부분 (전체 원문의 앞 일부만 포함됨):
---
{body_excerpt}
---

응답 형식:
{cat_line}

정확히 위의 형식 그대로 응답하고, '카테고리:' 다음에 정확히 하나의 카테고리만 표기해줘. 다른 말은 하지 말고."""
    else:
        prompt = f"""다음 문서의 제목을 분석하여 정확히 하나의 카테고리로 분류해줘.

{definitions}

분석할 문서 제목:
---
{title}
---

응답 형식:
{cat_line}

정확히 위의 형식 그대로 응답하고, '카테고리:' 다음에 정확히 하나의 카테고리만 표기해줘. 다른 말은 하지 말고."""

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "options": {
                        "temperature": 0.0,
                        "top_p": 0.7,
                    },
                    "stream": False,
                }
            )

            if response.status_code != 200:
                return fallback_category

            data = response.json()
            result = data.get("response", "").strip()

            line_texts = result.split("\n")
            for line in line_texts:
                line_lower = line.lower().strip()
                if "카테고리:" in line_lower:
                    category_part = line.split("카테고리:")[-1].strip()
                    for category in valid_categories:
                        if category in category_part:
                            return category

            for category in valid_categories:
                if category in result:
                    return category

            return fallback_category

    except Exception as e:
        print(f"⚠️ AI 분류 실패: {str(e)}, 폴백 사용: {fallback_category}")
        return fallback_category


async def categorize_document(
    title: str = "",
    extracted_text: Optional[str] = None,
    model: str = DEFAULT_MODEL,
) -> str:
    """
    PDF 문서의 제목과 본문 앞부분을 활용해 카테고리를 분류합니다.
    전체 원문은 DB에 그대로 두고, 분류에는 앞부분만 사용합니다.

    순서: 제목 키워드 → 본문 앞부분 키워드 → 둘 다 기타일 때만 LLM.

    카테고리(공문서 중심):
    - 법령·규정, 행정·공문, 보고·계획, 재정·계약, 기타

    Args:
        title: 문서 제목 (예: 파일명)
        extracted_text: OCR/추출된 전체 텍스트(선택). 있으면 앞 CATEGORIZE_BODY_PREFIX_CHARS자만 분류에 사용
        model: 사용할 AI 모델

    Returns:
        DOCUMENT_CATEGORIES 중 하나
    """
    title_fb = _fallback_categorize_by_title(title or "")
    if title_fb != DOCUMENT_CATEGORY_ETC:
        return title_fb

    body_prefix = ""
    if extracted_text and extracted_text.strip():
        body_prefix = extracted_text.strip()[:CATEGORIZE_BODY_PREFIX_CHARS]

    body_fb = DOCUMENT_CATEGORY_ETC
    if body_prefix:
        body_fb = _fallback_categorize(body_prefix, summary="")
    if body_fb != DOCUMENT_CATEGORY_ETC:
        return body_fb

    return await _categorize_with_llm(
        title=title or "",
        body_excerpt=body_prefix,
        model=model,
        fallback_category=DOCUMENT_CATEGORY_ETC,
    )


def _official_category_keyword_scores(search_text: str) -> dict:
    """소문자화된 문자열에 대해 공문서 카테고리별 키워드 점수를 계산합니다."""

    def calculate_score(keywords_dict: dict, text: str) -> float:
        score = 0.0
        for keyword, weight in keywords_dict.items():
            score += text.count(keyword) * weight
        return score

    law_regs = {
        "법안": 4,
        "법률안": 4,
        "법률": 3,
        "법령": 4,
        "시행령": 3,
        "시행규칙": 3,
        "조항": 3,
        "개정안": 3,
        "개정": 2,
        "제정": 2,
        "훈령": 3,
        "예규": 3,
        "행정규칙": 3,
        "조례": 3,
        "의안": 3,
        "입법": 2,
        "헌법": 3,
        "법제": 2,
        "판례": 2,
        "국회": 1,
        "대법원": 2,
        "법원": 1,
        "조문": 2,
        "부칙": 2,
        "bill": 4,
        "law": 3,
        "act": 3,
        "statute": 3,
        "ordinance": 3,
        "decree": 2,
    }
    admin_doc = {
        "공문": 4,
        "공문서": 4,
        "시달": 3,
        "협조요청": 4,
        "협조": 3,
        "회신": 3,
        "통지": 3,
        "통보": 2,
        "결재": 3,
        "품의": 3,
        "문서번호": 3,
        "발신": 2,
        "수신": 2,
        "수신자": 2,
        "참조": 1,
        "붙임": 2,
        "유통": 2,
        "전달": 2,
        "담당": 1,
        "행정": 1,
        "official": 2,
        "memorandum": 2,
    }
    report_plan = {
        "보고서": 4,
        "업무보고": 4,
        "검토보고": 4,
        "검토보고서": 4,
        "실적": 3,
        "현황": 3,
        "통계": 3,
        "분석": 2,
        "평가": 2,
        "보고": 2,
        "리포트": 3,
        "사업계획": 4,
        "추진계획": 4,
        "시행계획": 3,
        "중기계획": 3,
        "기본계획": 3,
        "연간": 2,
        "월간": 2,
        "분기": 2,
        "년간": 2,
        "진행상황": 3,
        "진행현황": 3,
        "report": 4,
        "analysis": 2,
        "statistics": 3,
    }
    finance_contract = {
        "예산": 4,
        "결산": 4,
        "입찰": 4,
        "입찰공고": 4,
        "계약": 4,
        "계약서": 4,
        "낙찰": 3,
        "지출": 3,
        "집행": 2,
        "재정": 3,
        "용역": 3,
        "구매": 3,
        "발주": 3,
        "지급": 2,
        "회계": 3,
        "견적": 2,
        "낙찰자": 3,
        "조달": 3,
        "budget": 4,
        "contract": 4,
        "bid": 3,
        "procurement": 3,
    }

    return {
        "법령·규정": calculate_score(law_regs, search_text),
        "행정·공문": calculate_score(admin_doc, search_text),
        "보고·계획": calculate_score(report_plan, search_text),
        "재정·계약": calculate_score(finance_contract, search_text),
    }


def _fallback_categorize_by_title(title: str) -> str:
    """
    문서 제목만을 기반으로 키워드 기반 폴백 분류를 수행합니다.
    """
    search_text = title.lower()
    scores = _official_category_keyword_scores(search_text)
    max_score = max(scores.values())
    MIN_THRESHOLD = 1
    if max_score > MIN_THRESHOLD:
        return max(scores, key=scores.get)
    return DOCUMENT_CATEGORY_ETC


def _fallback_categorize(text: str, summary: str = "") -> str:
    """
    AI 분류 실패 시 키워드 기반 폴백 분류를 수행합니다.
    """
    search_text = (summary + " " + text[:3000]).lower()
    scores = _official_category_keyword_scores(search_text)
    max_score = max(scores.values())
    MIN_THRESHOLD = 2
    if max_score > MIN_THRESHOLD:
        return max(scores, key=scores.get)

    primary_scores = {
        "법령·규정": sum(1 for kw in ["법령", "법률", "시행령", "의안", "법안"] if kw in search_text),
        "행정·공문": sum(1 for kw in ["공문", "협조", "시달", "회신", "결재"] if kw in search_text),
        "보고·계획": sum(1 for kw in ["보고서", "실적", "현황", "계획"] if kw in search_text),
        "재정·계약": sum(1 for kw in ["예산", "입찰", "계약", "결산"] if kw in search_text),
    }
    max_primary = max(primary_scores.values())
    if max_primary > 0:
        return max(primary_scores, key=primary_scores.get)

    return DOCUMENT_CATEGORY_ETC