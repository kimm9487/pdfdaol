"""
RAGAS를 이용한 RAG 파이프라인 평가 스크립트

사용법:
    python eval_ragas.py \
        --questions ragas_questions_sample.json \
        --model gemma3:latest \
        --embed-model nomic-embed-text \
        --ollama-url http://127.0.0.1:11434 \
        --chroma-url http://127.0.0.1:8000 \
        --scope shared \
        --top-k 4 \
        --output ragas_result.csv

필수 패키지 설치:
    pip install -r ragas_eval_requirements.txt

질문 JSON 포맷 (ragas_questions_sample.json 참고):
    [
        {
            "question": "계약 금액은 얼마입니까?",
            "document_text": "문서 본문 전체...",
            "ground_truth": "계약 금액은 5,000만원입니다."  ← 선택사항
        },
        ...
    ]

ground_truth가 없으면 faithfulness + answer_relevancy 만 평가합니다.
ground_truth가 있으면 context_recall 도 추가됩니다.
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
from typing import List, Optional, Tuple
from urllib.parse import urlparse

import httpx

# ---------------------------------------------------------------------------
# 환경 변수 기본값 (docker-compose.yml의 환경변수와 동일하게 맞춤)
# ---------------------------------------------------------------------------
DEFAULT_OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
DEFAULT_CHROMA_URL = os.getenv("CHROMA_BASE_URL", "http://127.0.0.1:8000")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemma3:latest")
DEFAULT_EMBED_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
DEFAULT_COLLECTION = os.getenv("CHROMA_COLLECTION", "documents")
DEFAULT_SHARED_COLLECTION = os.getenv(
    "CHROMA_SHARED_COLLECTION", f"{DEFAULT_COLLECTION}_hybrid"
)
DEFAULT_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
DEFAULT_SCOPE = "shared"


# ---------------------------------------------------------------------------
# Ollama 헬퍼
# ---------------------------------------------------------------------------
async def get_embedding(text: str, model: str, ollama_url: str) -> Optional[List[float]]:
    text = (text or "").strip()
    if not text:
        return None
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            resp.raise_for_status()
            return resp.json().get("embedding")
    except Exception as exc:
        print(f"  [embedding error] {exc}", file=sys.stderr)
        return None


async def generate_answer(
    system_prompt: str,
    user_prompt: str,
    model: str,
    ollama_url: str,
) -> str:
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={
                    "model": model,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "options": {
                        "temperature": 0.1,
                        "top_p": 0.7,
                        "num_ctx": 4096,
                        "num_predict": 800,
                    },
                    "stream": False,
                },
            )
            resp.raise_for_status()
            return resp.json().get("response", "").strip()
    except Exception as exc:
        print(f"  [generate error] {exc}", file=sys.stderr)
        return ""


# ---------------------------------------------------------------------------
# ChromaDB 헬퍼
# ---------------------------------------------------------------------------
def _get_chroma_client(chroma_url: str):
    try:
        import chromadb
    except ImportError:
        print("chromadb 패키지가 없습니다. pip install chromadb", file=sys.stderr)
        sys.exit(1)
    parsed = urlparse(chroma_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 8000)
    ssl = parsed.scheme == "https"
    return chromadb.HttpClient(host=host, port=port, ssl=ssl)


def _split_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


def _build_where(owner_id: Optional[str], fingerprint: str) -> dict:
    if owner_id:
        visibility_filter = {"$or": [{"visibility": "public"}, {"owner_id": owner_id}]}
    else:
        visibility_filter = {"visibility": "public"}
    return {
        "$and": [
            visibility_filter,
            {"doc_fingerprint": {"$eq": fingerprint}},
        ]
    }


async def retrieve_contexts(
    document_text: str,
    query: str,
    user_scope: str,
    top_k: int,
    embed_model: str,
    ollama_url: str,
    chroma_url: str,
    collection_name: str,
) -> List[str]:
    """문서를 ChromaDB에 색인하고 쿼리에 맞는 청크를 반환합니다."""
    text = (document_text or "").strip()
    if not text:
        return []

    chroma_client = _get_chroma_client(chroma_url)
    chunks = _split_text(text)
    if not chunks:
        return []

    # owner_id / visibility 결정 (공유 컬렉션 규칙과 동일)
    scope = user_scope
    if scope.startswith("user_"):
        owner_id = scope[len("user_"):]
        visibility = "private"
    else:
        owner_id = None
        visibility = "public"

    try:
        collection = chroma_client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
    except Exception as exc:
        print(f"  [chroma] 컬렉션 접근 실패: {exc}", file=sys.stderr)
        return chunks[:top_k]

    fingerprint = hashlib.sha1(text[:4000].encode("utf-8", errors="ignore")).hexdigest()[:12]

    # 아직 색인되지 않은 경우에만 upsert
    try:
        existing = collection.get(ids=[f"{fingerprint}-0"])
        if not existing["ids"]:
            emb_tasks = [get_embedding(c, embed_model, ollama_url) for c in chunks]
            emb_results = await asyncio.gather(*emb_tasks)
            ids, docs, embs, metas = [], [], [], []
            for idx, (chunk, emb) in enumerate(zip(chunks, emb_results)):
                if emb is None:
                    continue
                ids.append(f"{fingerprint}-{idx}")
                docs.append(chunk)
                embs.append(emb)
                metas.append({
                    "scope": scope,
                    "chunk_index": idx,
                    "owner_id": owner_id or "global",
                    "visibility": visibility,
                    "doc_fingerprint": fingerprint,
                })
            if ids:
                collection.upsert(ids=ids, documents=docs, embeddings=embs, metadatas=metas)
    except Exception as exc:
        print(f"  [chroma] upsert 실패: {exc}", file=sys.stderr)
        return chunks[:top_k]

    query_emb = await get_embedding(query, embed_model, ollama_url)
    if query_emb is None:
        return chunks[:top_k]

    try:
        where_filter = _build_where(owner_id, fingerprint)
        results = collection.query(
            query_embeddings=[query_emb],
            n_results=min(top_k, len(chunks)),
            where=where_filter,
            include=["documents", "distances"],
        )
        return (results.get("documents") or [[]])[0]
    except Exception as exc:
        print(f"  [chroma] query 실패: {exc}", file=sys.stderr)
        return chunks[:top_k]


# ---------------------------------------------------------------------------
# RAG 파이프라인 (단일 질문 실행)
# ---------------------------------------------------------------------------
async def run_rag(
    question: str,
    document_text: str,
    scope: str,
    top_k: int,
    model: str,
    embed_model: str,
    ollama_url: str,
    chroma_url: str,
    collection_name: str,
) -> Tuple[str, List[str]]:
    """contexts 리스트와 answer를 반환합니다."""
    contexts = await retrieve_contexts(
        document_text=document_text,
        query=question,
        user_scope=scope,
        top_k=top_k,
        embed_model=embed_model,
        ollama_url=ollama_url,
        chroma_url=chroma_url,
        collection_name=collection_name,
    )

    rag_block = ""
    if contexts:
        rag_block = (
            "\n[검색 문맥(RAG)]\n아래 문맥을 우선 참고해 답변하세요.\n"
            + "\n\n".join(f"[문맥 {i+1}] {c}" for i, c in enumerate(contexts))
        )

    system_prompt = (
        "당신은 문서 분석 전문가입니다. "
        "반드시 제공된 문서와 문맥만 근거로 답변하세요. "
        "모르면 '문서에서 해당 정보를 찾을 수 없습니다'라고 답하세요."
    )
    user_prompt = (
        f"{rag_block}\n\n[문서 본문]\n{document_text[:6000]}\n\n"
        f"[질문]\n{question}"
    ).strip()

    answer = await generate_answer(system_prompt, user_prompt, model, ollama_url)
    return answer, contexts


# ---------------------------------------------------------------------------
# RAGAS 평가
# ---------------------------------------------------------------------------
def run_ragas_eval(
    questions: List[str],
    answers: List[str],
    contexts_list: List[List[str]],
    ground_truths: Optional[List[Optional[str]]],
    model: str,
    embed_model: str,
    ollama_url: str,
) -> dict:
    """RAGAS 0.2.x API 로 평가합니다."""
    try:
        from ragas import evaluate, EvaluationDataset, SingleTurnSample
        from ragas.metrics import Faithfulness, AnswerRelevancy
        from ragas.llms import LangchainLLMWrapper
        from ragas.embeddings import LangchainEmbeddingsWrapper

        try:
            from langchain_ollama import ChatOllama, OllamaEmbeddings
        except ImportError:
            from langchain_community.chat_models import ChatOllama
            from langchain_community.embeddings import OllamaEmbeddings

        llm = LangchainLLMWrapper(
            ChatOllama(model=model, base_url=ollama_url, temperature=0)
        )
        embeddings = LangchainEmbeddingsWrapper(
            OllamaEmbeddings(model=embed_model, base_url=ollama_url)
        )

        has_ground_truth = ground_truths and any(g for g in ground_truths)

        # SingleTurnSample 빌드
        samples = []
        for i, (q, a, ctx) in enumerate(zip(questions, answers, contexts_list)):
            gt = (ground_truths[i] if ground_truths else None) or ""
            samples.append(
                SingleTurnSample(
                    user_input=q,
                    response=a,
                    retrieved_contexts=ctx,
                    reference=gt if gt else None,
                )
            )

        dataset = EvaluationDataset(samples=samples)

        metrics = [
            Faithfulness(llm=llm),
            AnswerRelevancy(llm=llm, embeddings=embeddings),
        ]

        if has_ground_truth:
            try:
                from ragas.metrics import ContextRecall
                metrics.append(ContextRecall(llm=llm))
            except ImportError:
                pass
            try:
                from ragas.metrics import LLMContextPrecisionWithoutReference
                metrics.append(LLMContextPrecisionWithoutReference(llm=llm))
            except ImportError:
                pass

        result = evaluate(dataset=dataset, metrics=metrics)
        return result

    except ImportError as e:
        _fallback_ragas_01x(
            questions, answers, contexts_list, ground_truths,
            model, embed_model, ollama_url, error=e
        )
        return {}


def _fallback_ragas_01x(
    questions, answers, contexts_list, ground_truths,
    model, embed_model, ollama_url, error=None
):
    """RAGAS 0.1.x 폴백 (import 실패 시 시도)"""
    if error:
        print(f"\n⚠️  RAGAS 0.2.x API 로드 실패 ({error}), 0.1.x API 시도 중...", file=sys.stderr)
    try:
        from ragas import evaluate
        from ragas.metrics import faithfulness, answer_relevancy, context_recall
        from langchain_community.chat_models import ChatOllama
        from langchain_community.embeddings import OllamaEmbeddings
        from datasets import Dataset

        data = {
            "question": questions,
            "answer": answers,
            "contexts": contexts_list,
        }
        has_ground_truth = ground_truths and any(g for g in ground_truths)
        if has_ground_truth:
            data["ground_truth"] = [g or "" for g in ground_truths]

        dataset = Dataset.from_dict(data)

        llm = ChatOllama(model=model, base_url=ollama_url, temperature=0)
        embeddings = OllamaEmbeddings(model=embed_model, base_url=ollama_url)

        metrics = [faithfulness, answer_relevancy]
        if has_ground_truth:
            metrics.append(context_recall)

        faithfulness.llm = llm  # type: ignore
        answer_relevancy.llm = llm  # type: ignore
        answer_relevancy.embeddings = embeddings  # type: ignore
        if has_ground_truth:
            context_recall.llm = llm  # type: ignore

        result = evaluate(dataset=dataset, metrics=metrics)
        print("\n=== RAGAS 평가 결과 (0.1.x) ===")
        print(result)
        return result
    except Exception as exc:
        print(f"\n❌ RAGAS 0.1.x 도 실패: {exc}", file=sys.stderr)
        return {}


# ---------------------------------------------------------------------------
# 결과 출력 및 저장
# ---------------------------------------------------------------------------
def print_and_save_results(
    result,
    questions: List[str],
    answers: List[str],
    contexts_list: List[List[str]],
    output_path: Optional[str],
):
    print("\n" + "=" * 60)
    print("=== RAGAS RAG 평가 결과 ===")
    print("=" * 60)

    # 메트릭 요약 출력
    if hasattr(result, "scores"):
        # 0.2.x EvaluationResult
        try:
            import pandas as pd
            df = result.to_pandas()
            print("\n[메트릭 평균]")
            metric_cols = [c for c in df.columns if c not in ("user_input", "response", "retrieved_contexts", "reference")]
            print(df[metric_cols].mean().to_string())
            print("\n[질문별 상세]")
            print(df.to_string(max_colwidth=60))
            if output_path:
                df.to_csv(output_path, index=False, encoding="utf-8-sig")
                print(f"\n💾 결과 저장: {output_path}")
        except Exception:
            print(result)
    elif isinstance(result, dict) and result:
        print("\n[메트릭 평균]")
        for k, v in result.items():
            if isinstance(v, float):
                print(f"  {k}: {v:.4f}")
        if output_path:
            try:
                import csv
                with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
                    writer = csv.writer(f)
                    writer.writerow(["metric", "score"])
                    for k, v in result.items():
                        writer.writerow([k, v])
                print(f"\n💾 결과 저장: {output_path}")
            except Exception as exc:
                print(f"  저장 실패: {exc}")
    else:
        print("평가 결과를 파싱할 수 없습니다.")

    # 질문/컨텍스트/답변 요약
    print("\n[질문 · 검색문맥 · 답변 요약]")
    for i, (q, ctxs, a) in enumerate(zip(questions, contexts_list, answers)):
        print(f"\n─ Q{i+1}: {q}")
        print(f"  검색된 문맥 수: {len(ctxs)}")
        if ctxs:
            print(f"  첫 번째 문맥(앞 100자): {ctxs[0][:100]}...")
        print(f"  답변(앞 150자): {a[:150]}{'...' if len(a) > 150 else ''}")


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
async def main():
    parser = argparse.ArgumentParser(
        description="RAGAS로 RAG 파이프라인 품질 평가"
    )
    parser.add_argument(
        "--questions", "-q",
        default="ragas_questions_sample.json",
        help="테스트 질문 JSON 파일 경로 (기본: ragas_questions_sample.json)",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="생성 LLM 모델명")
    parser.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL, help="임베딩 모델명")
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL, help="Ollama 서버 URL")
    parser.add_argument("--chroma-url", default=DEFAULT_CHROMA_URL, help="ChromaDB URL")
    parser.add_argument("--scope", default=DEFAULT_SCOPE, help="user_scope (shared / user_<id>)")
    parser.add_argument("--collection", default=DEFAULT_SHARED_COLLECTION, help="ChromaDB 컬렉션명")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K, help="검색할 청크 수")
    parser.add_argument("--output", "-o", default="ragas_result.csv", help="결과 CSV 저장 경로")
    args = parser.parse_args()

    # 질문 파일 로드
    questions_path = args.questions
    if not os.path.isabs(questions_path):
        questions_path = os.path.join(os.path.dirname(__file__), questions_path)

    if not os.path.exists(questions_path):
        print(f"❌ 질문 파일을 찾을 수 없습니다: {questions_path}", file=sys.stderr)
        print("  ragas_questions_sample.json 을 참고해 질문 파일을 만들어 주세요.", file=sys.stderr)
        sys.exit(1)

    with open(questions_path, encoding="utf-8") as f:
        test_cases = json.load(f)

    if not isinstance(test_cases, list) or not test_cases:
        print("❌ 질문 파일은 비어있지 않은 JSON 배열이어야 합니다.", file=sys.stderr)
        sys.exit(1)

    print(f"✅ 테스트 질문 {len(test_cases)}개 로드")
    print(f"   모델      : {args.model}")
    print(f"   임베딩    : {args.embed_model}")
    print(f"   Ollama    : {args.ollama_url}")
    print(f"   ChromaDB  : {args.chroma_url}")
    print(f"   컬렉션    : {args.collection}")
    print(f"   top_k     : {args.top_k}")

    # RAG 실행
    questions, answers, contexts_list, ground_truths = [], [], [], []

    for i, case in enumerate(test_cases):
        q = (case.get("question") or "").strip()
        doc_text = (case.get("document_text") or "").strip()
        gt = (case.get("ground_truth") or "").strip() or None

        if not q:
            print(f"  ⚠️  케이스 {i+1}: question 이 없어 건너뜁니다.")
            continue

        print(f"\n[{i+1}/{len(test_cases)}] 질문: {q[:60]}...")
        answer, contexts = await run_rag(
            question=q,
            document_text=doc_text,
            scope=args.scope,
            top_k=args.top_k,
            model=args.model,
            embed_model=args.embed_model,
            ollama_url=args.ollama_url,
            chroma_url=args.chroma_url,
            collection_name=args.collection,
        )
        print(f"  → 검색된 문맥: {len(contexts)}개, 답변: {len(answer)}자")

        questions.append(q)
        answers.append(answer)
        contexts_list.append(contexts if contexts else [""])
        ground_truths.append(gt)

    if not questions:
        print("❌ 유효한 질문이 없습니다.", file=sys.stderr)
        sys.exit(1)

    # RAGAS 평가
    print(f"\n🔍 RAGAS 평가 시작 (질문 {len(questions)}개)...")
    print("  (LLM 호출 횟수가 많아 수 분 걸릴 수 있습니다)")
    result = run_ragas_eval(
        questions=questions,
        answers=answers,
        contexts_list=contexts_list,
        ground_truths=ground_truths,
        model=args.model,
        embed_model=args.embed_model,
        ollama_url=args.ollama_url,
    )

    print_and_save_results(result, questions, answers, contexts_list, args.output)


if __name__ == "__main__":
    asyncio.run(main())
