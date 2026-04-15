import re


def _looks_like_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if len(stripped) > 70:
        return False
    if stripped.startswith(("#", "-", "*", "|")):
        return False
    return bool(re.match(r"^(\d+[\.\)]\s+|[가-힣A-Za-z]{1,20}\s*[:\-]\s*)", stripped))


def to_layout_markdown(text: str) -> str:
    """OCR/PDF 추출 텍스트를 원문 구조에 가깝게 마크다운 형태로 정리합니다."""
    if not text:
        return ""

    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    normalized = []
    blank_count = 0

    for raw in lines:
        line = raw.strip()
        if not line:
            blank_count += 1
            if blank_count <= 1:
                normalized.append("")
            continue

        blank_count = 0
        if _looks_like_heading(line):
            normalized.append(f"## {line}")
            continue

        # 구분선 패턴을 마크다운 수평선으로 정규화
        if re.fullmatch(r"[-_=]{3,}", line):
            normalized.append("---")
            continue

        normalized.append(line)

    # 표처럼 보이는 연속 라인(| 포함)은 그대로 유지
    return "\n".join(normalized).strip()

