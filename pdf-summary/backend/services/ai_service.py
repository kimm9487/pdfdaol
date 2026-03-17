import os
import re
import hashlib
import json
import httpx
from fastapi import HTTPException
from urllib.parse import urlparse
from typing import AsyncIterator, List, Optional, Tuple

try:
    import chromadb  # type: ignore
except Exception:
    chromadb = None

# Ollama/VectorDB 기본 설정
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemma3:latest")
LORA_MODEL_NAME = os.getenv("LORA_MODEL_NAME", "qwen2.5:3b-instruct-lora")
RAG_ENABLED = os.getenv("RAG_ENABLED", "true").strip().lower() == "true"
CHROMA_BASE_URL = os.getenv("CHROMA_BASE_URL", "http://chroma:8000")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "documents")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))


def _split_text_for_rag(text: str, chunk_size: int = 1200, overlap: int = 200) -> List[str]:
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


def _sanitize_collection_suffix(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]", "_", (value or "shared").strip())
    return normalized[:48] or "shared"


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
    collection_name = f"{CHROMA_COLLECTION}_{scope}"
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

    for idx, chunk in enumerate(chunks):
        emb = await _get_ollama_embedding(chunk)
        if emb is None:
            continue
        ids.append(f"{fingerprint}-{idx}")
        documents.append(chunk)
        embeddings.append(emb)
        metadatas.append({"scope": scope, "chunk_index": idx})

    if not ids:
        # 임베딩 실패 시 최소한 앞부분 문맥 제공
        fallback_docs = chunks[:2]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    try:
        collection.upsert(ids=ids, documents=documents, embeddings=embeddings, metadatas=metadatas)
    except Exception as exc:
        print(f"⚠️ Chroma upsert 실패: {str(exc)}")
        fallback_docs = chunks[:2]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    query_emb = await _get_ollama_embedding(query)
    if query_emb is None:
        fallback_docs = chunks[:2]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    try:
        results = collection.query(
            query_embeddings=[query_emb],
            n_results=min(max(top_k, 1), len(ids)),
            include=["documents", "distances"],
        )
        doc_hits = (results.get("documents") or [[]])[0]
    except Exception as exc:
        print(f"⚠️ Chroma query 실패: {str(exc)}")
        doc_hits = []

    if not doc_hits:
        fallback_docs = chunks[:2]
        return "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(fallback_docs)), len(fallback_docs)

    context = "\n\n".join(f"[문맥 {i+1}] {chunk}" for i, chunk in enumerate(doc_hits))
    return context, len(doc_hits)


async def summarize_text(text: str, model: str = DEFAULT_MODEL) -> str:
    """
    Ollama API를 호출하여 텍스트를 요약합니다.
    """
    MAX_CHARS = 8000
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n\n[... 이하 내용 생략 ...]"

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
                    "stream": False,
                },
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
        text = text[:MAX_CHARS] + "\n\n[... 이하 내용 생략 ...]"

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
    MAX_CHARS = 12000
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n\n[... 이하 내용 생략 ...]"

    clean_instruction = (instruction or "핵심 내용을 짧게 요약해줘").strip()
    if not clean_instruction:
        clean_instruction = "핵심 내용을 짧게 요약해줘"

    selected_model = LORA_MODEL_NAME if use_lora else model
    if not selected_model:
        selected_model = DEFAULT_MODEL

    rag_context = ""
    rag_count = 0
    if use_rag:
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

    prompt = f"""당신은 문서 분석 도우미입니다.
아래 사용자의 요청을 가장 우선으로 반영해 한국어로 답변하세요.

[사용자 요청]
{clean_instruction}

{rag_block}

[문서 내용]
{text}

[응답 규칙]
- 요청이 요약이면 핵심 위주로 간결하게 작성
- 요청이 목록/표 형태를 원하면 그 형식에 맞게 작성
- 문서에 없는 내용은 추측하지 않음
- RAG 문맥이 있으면 해당 근거를 우선 반영
"""

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": selected_model,
                    "prompt": prompt,
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
            if rag_count > 0:
                answer = f"{answer}\n\n(참고 문맥 {rag_count}개 기반)"
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
    
    chunks = []
    start = 0
    
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        
        # 문장 경계에서 자르기 시도
        if end < len(text):
            last_period = text.rfind('.', start, end)
            last_newline = text.rfind('\n', start, end)
            boundary = max(last_period, last_newline)
            if boundary > start + CHUNK_SIZE // 2:
                end = boundary + 1
        
        chunk = text[start:end]
        chunks.append(chunk)

        # 마지막 청크를 추가한 뒤에는 루프를 종료해야 중복/무한 루프를 방지할 수 있습니다.
        if end >= len(text):
            break

        next_start = max(0, end - OVERLAP)
        # 경계 조건에서 start가 전진하지 못하면 안전하게 종료합니다.
        if next_start <= start:
            break
        start = next_start
    
    translated_chunks = []
    for i, chunk in enumerate(chunks):
        try:
            translated = await translate_to_english(chunk, model)
            translated_chunks.append(translated)
        except Exception as e:
            translated_chunks.append(f"[번역 실패 구간 {i+1}: {str(e)}]")
    
    return "\n\n".join(translated_chunks)


async def get_available_models() -> list:
    """
    Ollama에 설치된 모델 목록을 반환합니다.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                data = response.json()
                return [m["name"] for m in data.get("models", [])]
            return []
    except Exception:
        return []


async def categorize_document(title: str = "", model: str = DEFAULT_MODEL) -> str:
    """
    PDF 문서의 제목을 분석하여 카테고리를 분류합니다.
    
    카테고리:
    - 강의: 교육, 강의, 수업, 학습 관련 제목
    - 법률안: 법안, 법률, 규정, 조항, 시행령 등 법적 제목
    - 보고서: 보고서, 분석, 통계, 현황 등 보고 성질의 제목
    - 기타: 위의 카테고리에 해당하지 않는 기타 제목
    
    Args:
        title: 문서 제목 (예: 파일명)
        model: 사용할 AI 모델
        
    Returns:
        분류된 카테고리: '강의', '법률안', '보고서', '기타' 중 하나
    """
    # 먼저 폴백(키워드 기반) 분류를 시도해서 정확도 높임
    fallback_category = _fallback_categorize_by_title(title)
    
    # 폴백 분류가 "기타"가 아니면 그것을 사용 (더 확실함)
    if fallback_category != "기타":
        return fallback_category
    
    # 폴백이 "기타"인 경우만 AI 분류 시도
    prompt = f"""다음 문서의 제목을 분석하여 정확히 하나의 카테고리로 분류해줘.
    
카테고리 정의:
1. 강의: 교육, 강의, 수업, 학습, 교과서, 튜토리얼 등 교육 목적의 제목
2. 법률안: 법안, 법률, 법령, 규정, 시행령, 조항, 법적 조항 등 법적 성질의 제목
3. 보고서: 보고서, 리포트, 분석 보고서, 통계, 현황 보고, 연간 보고서 등 보고 성질의 제목
4. 기타: 위의 세 카테고리에 명확하게 해당하지 않는 모든 제목

분석할 문서 제목:
---
{title}
---

응답 형식:
카테고리: [강의 또는 법률안 또는 보고서 또는 기타]

정확히 위의 형식 그대로 응답하고, '카테고리:' 다음에 정확히 하나의 카테고리만 표기해줘. 다른 말은 하지 말고."""

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                },
            )

            if response.status_code != 200:
                # API 오류 시 폴백 반환
                return fallback_category

            data = response.json()
            result = data.get("response", "").strip()
            
            # 응답에서 카테고리 추출 (더 견고한 파싱)
            line_texts = result.split("\n")
            for line in line_texts:
                line_lower = line.lower().strip()
                
                # "카테고리:" 시작 라인 찾기
                if "카테고리:" in line_lower:
                    category_part = line.split("카테고리:")[-1].strip()
                    
                    # 유효한 카테고리가 포함되어 있는지 확인
                    valid_categories = ["강의", "법률안", "보고서", "기타"]
                    for category in valid_categories:
                        if category in category_part:
                            return category
            
            # 응답에서 직접 카테고리명 찾기
            valid_categories = ["강의", "법률안", "보고서", "기타"]
            for category in valid_categories:
                if category in result:
                    return category
            
            # 파싱 실패 시 폴백 분류 사용
            return fallback_category

    except Exception as e:
        # 오류 발생 시 폴백 분류 사용
        print(f"⚠️ AI 분류 실패: {str(e)}, 폴백 사용: {fallback_category}")
        return fallback_category


def _fallback_categorize_by_title(title: str) -> str:
    """
    문서 제목만을 기반으로 키워드 기반 폴백 분류를 수행합니다.
    """
    # 제목을 소문자로 변환
    search_text = title.lower()
    
    # ===== [강의] 교육/학습 관련 키워드 =====
    lecture_keywords = {
        # 핵심 키워드
        "강의": 3, "수업": 3, "교육": 2, "학습": 2, "교과서": 3, "강의교안": 4, "강의자료": 4,
        # English core keywords
        "lecture": 3, "class": 2, "course": 3, "lesson": 2, "textbook": 3,
        # 관련 키워드
        "학생": 2, "교사": 2, "교수": 2, "튜토리얼": 3, "온라인 강좌": 3,
        "수강": 2, "과목": 2, "교과": 2, "학습 목표": 3, "강의 내용": 3,
        "수강생": 2, "교실": 2, "학급": 2, "학년": 2, "학기": 1,
        "시험": 1, "문제": 1, "해답": 1, "풀이": 1, "연습문제": 2,
        "강의 자료": 3, "강의 노트": 3, "수강 신청": 2, "교육 과정": 2,
        "학습 내용": 2, "수업 자료": 2, "교육 자료": 2, "강좌": 2,
        "수련": 1, "훈련": 1, "워크숍": 2, "세미나": 2, "강습": 2,
        "기초": 1, "입문": 1, "초급": 1, "중급": 1, "고급": 1,
        "한국어": 1, "영어": 1, "수학": 1, "과학": 1, "역사": 1,
        # English related keywords
        "tutorial": 3, "workshop": 2, "seminar": 2, "training": 2, "curriculum": 2,
        "syllabus": 2, "lab": 1, "beginner": 1, "intermediate": 1, "advanced": 1
    }
    
    # ===== [법률안] 법률/규정 관련 키워드 =====
    law_keywords = {
        # 핵심 키워드
        "법안": 4, "법률": 3, "법령": 3, "규정": 3, "조항": 3, "의안":4,
        # English core keywords
        "bill": 4, "law": 3, "act": 3, "regulation": 3, "clause": 3,
        # 관련 키워드
        "시행령": 3, "시행규칙": 3, "법적": 2, "제정": 2, "개정": 2,
        "조례": 3, "의안": 3, "의회": 2, "국회": 2, "입법": 2,
        "판례": 2, "계약": 2, "약관": 2, "조건": 1, "의원": 1,
        "법무": 2, "판사": 2, "검사": 2, "변호사": 2, "소송": 2,
        "권리": 1, "의무": 1, "책임": 1, "위반": 1, "처벌": 1,
        "조직법": 3, "형법": 3, "민법": 3, "행정법": 3, "상법": 3,
        "법인": 2, "개인": 1, "기관": 1, "부서": 1, "직책": 1,
        "규격": 1, "기준": 1, "표준": 1, "준칙": 2, "지침": 1,
        "허가": 1, "인가": 1, "승인": 1, "신청": 1, "절차": 1,
        "효력": 1, "발효": 1, "구속력": 2, "법적효력": 3,
        # English related keywords
        "legal": 2, "statute": 3, "ordinance": 3, "amendment": 2, "decree": 2,
        "legislation": 2, "article": 2, "compliance": 2, "policy": 1
    }
    
    # ===== [보고서] 보고/분석 관련 키워드 =====
    report_keywords = {
        # 핵심 키워드
        "보고서": 4, "보고": 2, "리포트": 3, "분석": 2, "통계": 3,
        # English core keywords
        "report": 4, "analysis": 3, "statistics": 3, "survey": 2,
        # 관련 키워드
        "현황": 2, "결과": 1, "조사": 2, "데이터": 2, "연간": 2,
        "월간": 2, "분기": 2, "실적": 2, "평가": 2, "진행": 1,
        "현황 보고": 4, "기간 완료": 2, "포함": 1, "자료": 1, "수치": 1,
        "그래프": 1, "차트": 1, "표": 1, "요약": 1, "결론": 1,
        "분석 결과": 3, "조사 결과": 3, "통계 자료": 3, "통계 현황": 3,
        "성과": 1, "진행상황": 2, "진행현황": 2, "상황": 1, "개요": 1,
        "연도별": 2, "년도": 1, "기준": 1, "기준일": 1, "말": 1,
        "지표": 1, "지수": 1, "비율": 1, "백분율": 1, "수준": 1,
        # English related keywords
        "status": 2, "result": 1, "findings": 2, "annual": 2, "monthly": 2,
        "quarterly": 2, "trend": 1, "metric": 1, "dashboard": 1, "summary": 1,
        "data": 2, "chart": 1, "table": 1
    }
    
    # ===== 점수 계산 =====
    def calculate_score(keywords_dict: dict, text: str) -> float:
        """키워드 딕셔너리를 기반으로 점수를 계산합니다."""
        score = 0
        for keyword, weight in keywords_dict.items():
            count = text.count(keyword)
            score += count * weight
        return score
    
    lecture_score = calculate_score(lecture_keywords, search_text)
    law_score = calculate_score(law_keywords, search_text)
    report_score = calculate_score(report_keywords, search_text)
    
    # ===== 점수 기반 분류 =====
    scores = {
        "강의": lecture_score,
        "법률안": law_score,
        "보고서": report_score
    }
    
    max_score = max(scores.values())
    
    # 최소 점수 기준 (점수가 너무 낮으면 기타로 분류)
    MIN_THRESHOLD = 1
    
    if max_score > MIN_THRESHOLD:
        max_category = max(scores, key=scores.get)
        return max_category
    
    return "기타"


def _fallback_categorize(text: str, summary: str = "") -> str:
    """
    AI 분류 실패 시 키워드 기반 폴백 분류를 수행합니다.
    더 많은 키워드와 가중치를 사용하여 정확도를 높입니다.
    """
    # 분석할 텍스트 준비 (처음 3000자 사용)
    search_text = (summary + " " + text[:3000]).lower()
    
    # ===== [강의] 교육/학습 관련 키워드 =====
    lecture_keywords = {
        # 핵심 키워드
        "강의": 3, "수업": 3, "교육": 2, "학습": 2, "교과서": 3,
        # English core keywords
        "lecture": 3, "class": 2, "course": 3, "lesson": 2, "textbook": 3,
        # 관련 키워드
        "학생": 2, "교사": 2, "교수": 2, "튜토리얼": 3, "온라인 강좌": 3,
        "수강": 2, "과목": 2, "교과": 2, "학습 목표": 3, "강의 내용": 3,
        "수강생": 2, "교실": 2, "학급": 2, "학년": 2, "학기": 1,
        "시험": 1, "문제": 1, "해답": 1, "풀이": 1, "연습문제": 2,
        "강의 자료": 3, "강의 노트": 3, "수강 신청": 2, "교육 과정": 2,
        "학습 내용": 2, "수업 자료": 2, "교육 자료": 2, "강좌": 2,
        "수련": 1, "훈련": 1, "워크숍": 2, "세미나": 2, "강습": 2,
        "기초": 1, "입문": 1, "초급": 1, "중급": 1, "고급": 1,
        "한국어": 1, "영어": 1, "수학": 1, "과학": 1, "역사": 1,
        # English related keywords
        "tutorial": 3, "workshop": 2, "seminar": 2, "training": 2, "curriculum": 2,
        "syllabus": 2, "lab": 1, "beginner": 1, "intermediate": 1, "advanced": 1
    }
    
    # ===== [법률안] 법률/규정 관련 키워드 =====
    law_keywords = {
        # 핵심 키워드
        "법안": 4, "법률": 3, "법령": 3, "규정": 3, "조항": 3,
        # English core keywords
        "bill": 4, "law": 3, "act": 3, "regulation": 3, "clause": 3,
        # 관련 키워드
        "시행령": 3, "시행규칙": 3, "법적": 2, "제정": 2, "개정": 2,
        "조례": 3, "의안": 3, "의회": 2, "국회": 2, "입법": 2,
        "판례": 2, "계약": 2, "약관": 2, "조건": 1, "의원": 1,
        "법무": 2, "판사": 2, "검사": 2, "변호사": 2, "소송": 2,
        "권리": 1, "의무": 1, "책임": 1, "위반": 1, "처벌": 1,
        "조직법": 3, "형법": 3, "민법": 3, "행정법": 3, "상법": 3,
        "법인": 2, "개인": 1, "기관": 1, "부서": 1, "직책": 1,
        "규격": 1, "기준": 1, "표준": 1, "준칙": 2, "지침": 1,
        "허가": 1, "인가": 1, "승인": 1, "신청": 1, "절차": 1,
        "효력": 1, "발효": 1, "구속력": 2, "법적효력": 3,
        # English related keywords
        "legal": 2, "statute": 3, "ordinance": 3, "amendment": 2, "decree": 2,
        "legislation": 2, "article": 2, "compliance": 2, "policy": 1
    }
    
    # ===== [보고서] 보고/분석 관련 키워드 =====
    report_keywords = {
        # 핵심 키워드
        "보고서": 4, "보고": 2, "리포트": 3, "분석": 2, "통계": 3,
        # English core keywords
        "report": 4, "analysis": 3, "statistics": 3, "survey": 2,
        # 관련 키워드
        "현황": 2, "결과": 1, "조사": 2, "데이터": 2, "연간": 2,
        "월간": 2, "분기": 2, "실적": 2, "평가": 2, "진행": 1,
        "현황 보고": 4, "기간 완료": 2, "포함": 1, "자료": 1, "수치": 1,
        "그래프": 1, "차트": 1, "표": 1, "요약": 1, "결론": 1,
        "분석 결과": 3, "조사 결과": 3, "통계 자료": 3, "통계 현황": 3,
        "성과": 1, "진행상황": 2, "진행현황": 2, "상황": 1, "개요": 1,
        "요약": 1, "정리": 1, "고찰": 1, "고점": 1, "변동": 1,
        "증감": 1, "상승": 1, "하락": 1, "변화": 1, "추이": 1,
        "연도별": 2, "년도": 1, "기준": 1, "기준일": 1, "말": 1,
        "지표": 1, "지수": 1, "비율": 1, "백분율": 1, "수준": 1,
        # English related keywords
        "status": 2, "result": 1, "findings": 2, "annual": 2, "monthly": 2,
        "quarterly": 2, "trend": 1, "metric": 1, "dashboard": 1, "summary": 1,
        "data": 2, "chart": 1, "table": 1
    }
    
    # ===== 점수 계산 =====
    def calculate_score(keywords_dict: dict, text: str) -> float:
        """키워드 딕셔너리를 기반으로 점수를 계산합니다."""
        score = 0
        for keyword, weight in keywords_dict.items():
            count = text.count(keyword)
            score += count * weight
        return score
    
    lecture_score = calculate_score(lecture_keywords, search_text)
    law_score = calculate_score(law_keywords, search_text)
    report_score = calculate_score(report_keywords, search_text)
    
    # ===== 점수 기반 분류 =====
    scores = {
        "강의": lecture_score,
        "법률안": law_score,
        "보고서": report_score
    }
    
    max_score = max(scores.values())
    
    # 최소 점수 기준 (점수가 너무 낮으면 기타로 분류)
    MIN_THRESHOLD = 2
    
    if max_score > MIN_THRESHOLD:
        max_category = max(scores, key=scores.get)
        return max_category
    
    # 스코어가 비슷한 경우 더 정밀한 분류
    # 핵심 키워드 재계산
    lecture_primary = sum(1 for kw in ["강의", "수업", "교육", "학습"] if kw in search_text)
    law_primary = sum(1 for kw in ["법안", "법률", "규정", "조항"] if kw in search_text)
    report_primary = sum(1 for kw in ["보고서", "분석", "통계"] if kw in search_text)
    
    primary_scores = {
        "강의": lecture_primary,
        "법률안": law_primary,
        "보고서": report_primary
    }
    
    max_primary = max(primary_scores.values())
    if max_primary > 0:
        return max(primary_scores, key=primary_scores.get)
    
    return "기타"
