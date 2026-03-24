"""
GLM-OCR extractor — REST API 기반 구현
내부적으로 Ollama(또는 vLLM/SGLang)에 올라간 GLM-OCR 서버를 HTTP API로 호출합니다.

환경변수:
  GLM_OCR_API_HOST      : OCR 서버 호스트 (기본값: glmocr  ← docker-compose 서비스명)
  GLM_OCR_API_PORT      : OCR 서버 포트  (기본값: 11434  ← Ollama 기본 포트)
  GLM_OCR_API_SCHEME    : http / https   (기본값: http)
  GLM_OCR_API_KEY       : API 키, 로컬 Ollama 면 불필요 (기본값: 빈 문자열)
  GLM_OCR_MODEL         : 모델명 (기본값: glm-ocr)
  GLM_OCR_API_TIMEOUT   : 요청 타임아웃 초 (기본값: 120)
  GLM_OCR_API_PATH      : API 경로 강제 지정 (예: /api/chat, /api/generate)
"""

import os
import time
import io
import base64
import asyncio
import logging

from fastapi import HTTPException
import requests

from .pdf_page_renderer import render_input_to_images
from .image_preprocess import preprocess_for_ocr
from .markdown_layout import to_layout_markdown
from .types import OcrResult

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "y", "on")


def _build_glmocr_config():
    """GLM-OCR REST API 호출 설정을 반환합니다."""
    api_host = os.getenv("GLM_OCR_API_HOST", "glmocr")
    api_port = int(os.getenv("GLM_OCR_API_PORT", "11434"))
    api_scheme = os.getenv("GLM_OCR_API_SCHEME", "http")
    api_key = os.getenv("GLM_OCR_API_KEY", "") or None
    model = os.getenv("GLM_OCR_MODEL", "glm-ocr")
    timeout = float(os.getenv("GLM_OCR_API_TIMEOUT", "120"))
    forced_path = (os.getenv("GLM_OCR_API_PATH", "") or "").strip()
    max_parallel = max(1, int(os.getenv("GLM_OCR_MAX_PARALLEL", "3")))
    max_image_side = max(0, int(os.getenv("GLM_OCR_MAX_IMAGE_SIDE", "2000")))
    retry_on_empty = _env_bool("GLM_OCR_RETRY_ON_EMPTY", True)
    enable_timing_log = _env_bool("GLM_OCR_ENABLE_TIMING_LOG", True)
    base_url = f"{api_scheme}://{api_host}:{api_port}"
    return {
        "base_url": base_url.rstrip("/"),
        "api_key": api_key,
        "model": model,
        "timeout": timeout,
        "forced_path": forced_path,
        "max_parallel": max_parallel,
        "max_image_side": max_image_side,
        "retry_on_empty": retry_on_empty,
        "enable_timing_log": enable_timing_log,
    }


def _resize_for_ocr(pil_image, max_side: int):
    """긴 변을 제한해 요청 페이로드와 추론 시간을 줄입니다."""
    if max_side <= 0:
        return pil_image
    width, height = pil_image.size
    longest = max(width, height)
    if longest <= max_side:
        return pil_image
    ratio = max_side / float(longest)
    new_size = (max(1, int(width * ratio)), max(1, int(height * ratio)))
    return pil_image.resize(new_size)


def _image_to_base64_png(pil_image) -> str:
    """PIL 이미지를 PNG Base64 문자열로 변환합니다."""
    buf = io.BytesIO()
    pil_image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _extract_text_from_response(data) -> str:
    """chat/generate 응답 JSON에서 텍스트를 추출합니다."""
    if isinstance(data, dict):
        message = data.get("message")
        if isinstance(message, dict):
            text = (message.get("content") or "").strip()
            if text:
                return text
        text = (data.get("response") or "").strip()
        if text:
            return text
        # 호환 목적: 커스텀 키 대응
        for key in ("text", "content", "result"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _post_ollama(path: str, payload: dict, config: dict, headers: dict):
    """단일 엔드포인트로 POST 요청을 전송합니다."""
    url = f"{config['base_url']}{path}"
    return requests.post(url, json=payload, headers=headers, timeout=config["timeout"])


def _ocr_pil_image(config, pil_image) -> str:
    """PIL Image 한 장을 GLM-OCR REST API로 처리해 텍스트를 반환합니다."""
    image_b64 = _image_to_base64_png(pil_image)
    headers = {"Content-Type": "application/json"}
    if config["api_key"]:
        headers["Authorization"] = f"Bearer {config['api_key']}"

    prompt = (
        "Extract all readable text from this image and preserve original layout in markdown. "
        "Keep headings, paragraph breaks, list markers, and table-like rows as close to source as possible. "
        "Do not summarize."
    )

    chat_payload = {
        "model": config["model"],
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [image_b64],
            }
        ],
    }
    generate_payload = {
        "model": config["model"],
        "stream": False,
        "prompt": prompt,
        "images": [image_b64],
    }

    if config["forced_path"]:
        paths_to_try = [config["forced_path"]]
    else:
        # Ollama 표준 엔드포인트를 순차 시도합니다.
        paths_to_try = ["/api/chat", "/api/generate"]

    last_error = None
    for path in paths_to_try:
        payload = chat_payload if path.endswith("/chat") else generate_payload
        try:
            resp = _post_ollama(path, payload, config, headers)
            if resp.status_code == 404 and not config["forced_path"]:
                continue
            resp.raise_for_status()
            return to_layout_markdown(_extract_text_from_response(resp.json()))
        except requests.RequestException as exc:
            last_error = str(exc)
            if not config["forced_path"] and path in ("/api/chat", "/api/generate"):
                continue
            break
        except ValueError as exc:
            last_error = f"JSON 파싱 실패: {exc}"
            break

    raise HTTPException(
        status_code=503,
        detail=f"GLM-OCR API 호출 실패: {last_error or '알 수 없는 오류'}",
    )


async def _process_single_page(idx: int, image, config: dict, semaphore: asyncio.Semaphore):
    """페이지 단위 OCR 처리(병렬 실행 대상)."""
    async with semaphore:
        page_start = time.time()
        retried = False
        try:
            base_image = _resize_for_ocr(image, config["max_image_side"])
            page_text = await asyncio.to_thread(_ocr_pil_image, config, base_image)
            first_call_elapsed = time.time() - page_start

            if not page_text and config["retry_on_empty"]:
                retried = True
                prepared = preprocess_for_ocr(image)
                prepared = _resize_for_ocr(prepared, config["max_image_side"])
                retry_start = time.time()
                page_text = await asyncio.to_thread(_ocr_pil_image, config, prepared)
                retry_elapsed = time.time() - retry_start
            else:
                retry_elapsed = 0.0

            total_elapsed = time.time() - page_start
            if config["enable_timing_log"]:
                logger.info(
                    "[GLM-OCR] page=%s first=%.2fs retry=%.2fs total=%.2fs retried=%s text_len=%s",
                    idx,
                    first_call_elapsed,
                    retry_elapsed,
                    total_elapsed,
                    retried,
                    len(page_text or ""),
                )
            return idx, page_text, None
        except Exception as exc:
            total_elapsed = time.time() - page_start
            if config["enable_timing_log"]:
                logger.warning(
                    "[GLM-OCR] page=%s failed_after=%.2fs error=%s",
                    idx,
                    total_elapsed,
                    exc,
                )
            return idx, "", str(exc)


async def extract_text(contents: bytes, filename: str) -> OcrResult:
    """
    GLM-OCR REST API를 사용해 텍스트를 추출합니다.
    PDF와 이미지 모두 지원합니다.
    """
    start_time = time.time()

    if not contents:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    extension = filename[filename.rfind("."):].lower() if "." in filename else ""
    images = render_input_to_images(contents, extension)

    config = _build_glmocr_config()

    parts = []
    successful_pages = 0
    first_error = None

    semaphore = asyncio.Semaphore(config["max_parallel"])
    tasks = [
        _process_single_page(idx, image, config, semaphore)
        for idx, image in enumerate(images, start=1)
    ]
    results = await asyncio.gather(*tasks)
    results.sort(key=lambda x: x[0])

    for idx, page_text, error in results:
        if page_text:
            parts.append(f"[페이지 {idx}]\n{page_text}")
            successful_pages += 1
        elif error and first_error is None:
            first_error = error

    processing_time = time.time() - start_time
    merged = "\n\n".join(parts).strip()

    if not merged:
        detail = "GLM-OCR 추출 결과가 비어 있습니다."
        if first_error:
            detail += f" 첫 오류: {first_error}"
        raise HTTPException(status_code=422, detail=detail)

    return {
        "text": merged,
        "total_pages": len(images),
        "successful_pages": successful_pages,
        "processing_time": processing_time,
        "char_count": len(merged),
        "ocr_model": "glmocr",
    }