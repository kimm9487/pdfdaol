import httpx
from fastapi import HTTPException

# Ollama 기본 설정
OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "gemma3:latest"  


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
            detail="Ollama 서버에 연결할 수 없습니다. 'ollama serve' 명령어로 서버를 실행해주세요."
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 요약 중 오류 발생: {str(e)}")


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
            detail="Ollama 서버에 연결할 수 없습니다. 'ollama serve' 명령어로 서버를 실행해주세요."
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
        
        start = max(0, end - OVERLAP)
        if start >= end:
            break
    
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


async def categorize_document(text: str, summary: str = "", model: str = DEFAULT_MODEL) -> str:
    """
    PDF 문서의 내용을 분석하여 카테고리를 분류합니다.
    
    카테고리:
    - 강의: 교육, 강의, 수업, 학습 관련 내용
    - 법률안: 법안, 법률, 규정, 조항, 시행령 등 법적 문서
    - 보고서: 보고서, 분석, 통계, 현황 등 보고 성질의 문서  
    - 기타: 위의 카테고리에 해당하지 않는 기타 문서
    
    Args:
        text: 추출된 원문 텍스트
        summary: 생성된 요약 (선택사항)
        model: 사용할 AI 모델
        
    Returns:
        분류된 카테고리: '강의', '법률안', '보고서', '기타' 중 하나
    """
    # 분류할 텍스트 준비 (요약이 있으면 요약 + 원문의 처음 부분 사용)
    classification_text = ""
    if summary:
        classification_text = summary
    
    if len(text) > 3000:
        classification_text += "\n\n" + text[:3000]
    else:
        classification_text += "\n\n" + text
    
    prompt = f"""다음 문서의 내용을 분석하여 정확히 하나의 카테고리로 분류해줘.
    
카테고리 정의:
1. 강의: 교육, 강의, 수업, 학습, 교과서, 튜토리얼 등 교육 목적의 문서
2. 법률안: 법안, 법률, 법령, 규정, 시행령, 조항, 법적 조항 등 법적 성질의 문서
3. 보고서: 보고서, 리포트, 분석 보고서, 통계, 현황 보고, 연간 보고서 등 보고 성질의 문서
4. 기타: 위의 세 카테고리에 명확하게 해당하지 않는 모든 문서

분석할 문서:
---
{classification_text}
---

응답 형식:
카테고리: [강의|법률안|보고서|기타]
근거: 한두 문장으로 분류 이유 설명

반드시 위의 형식 그대로 응답하고, '카테고리:' 다음에 정확히 하나의 카테고리만 표기해줘."""

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
                # API 오류 시 기본값 반환
                return "기타"

            data = response.json()
            result = data.get("response", "").strip()
            
            # 응답에서 카테고리 추출
            if "카테고리:" in result:
                category_line = result.split("카테고리:")[1].split("\n")[0].strip()
                
                # 유효한 카테고리인지 확인
                valid_categories = ["강의", "법률안", "보고서", "기타"]
                for category in valid_categories:
                    if category in category_line:
                        return category
            
            # 파싱 실패 시 텍스트 분석으로 폴백
            return _fallback_categorize(text, summary)

    except Exception:
        # 오류 발생 시 폴백 분류 사용
        return _fallback_categorize(text, summary)


def _fallback_categorize(text: str, summary: str = "") -> str:
    """
    AI 분류 실패 시 키워드 기반 폴백 분류를 수행합니다.
    """
    combined_text = (summary + " " + text[:2000]).lower()
    
    # 강의 관련 키워드
    lecture_keywords = ["강의", "수업", "교육", "학습", "교과서", "학생", "교사", "튜토리얼", 
                        "수강", "과목", "교과", "학습 목표", "강의 내용", "수강생"]
    
    # 법률안 관련 키워드
    law_keywords = ["법안", "법률", "법령", "규정", "조항", "시행령", "시행규칙", "법적", 
                    "제정", "개정", "조례", "의안", "의회", "국회", "입법", "판례",
                    "계약", "약관", "조건", "의원"]
    
    # 보고서 관련 키워드
    report_keywords = ["보고서", "보고", "리포트", "분석", "통계", "현황", "결과", "조사",
                       "통계", "데이터", "연간", "월간", "분기", "실적", "평가", "진행 상황",
                       "현황 보고", "기간 완료"]
    
    lecture_count = sum(combined_text.count(kw) for kw in lecture_keywords)
    law_count = sum(combined_text.count(kw) for kw in law_keywords)
    report_count = sum(combined_text.count(kw) for kw in report_keywords)
    
    # 가장 많은 키워드를 가진 카테고리로 분류
    counts = {
        "강의": lecture_count,
        "법률안": law_count,
        "보고서": report_count
    }
    
    max_category = max(counts, key=counts.get)
    if counts[max_category] > 0:
        return max_category
    
    return "기타"
