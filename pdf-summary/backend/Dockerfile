FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04 AS base
#                              ^^^^^ runtime → devel 로 변경

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# ──────────────────────────────────────────
FROM base AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    git \
    python3 \
    python3-venv \
    python3-distutils \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
RUN /opt/venv/bin/pip install --upgrade pip setuptools wheel

# 1. torch (CUDA 12.1 wheel) — GLM-OCR과 공유
RUN /opt/venv/bin/pip install \
    torch==2.1.0 \
    torchvision==0.16.0 \
    --index-url https://download.pytorch.org/whl/cu121

# 2. paddlepaddle-gpu (torch와 분리)
RUN /opt/venv/bin/pip install paddlepaddle-gpu==2.6.1 \
    -f https://www.paddlepaddle.org.cn/whl/linux/mkl/avx/stable.html

# 3. easyocr (--no-deps로 torch 재설치 방지)
RUN /opt/venv/bin/pip install easyocr==1.7.1 --no-deps && \
    /opt/venv/bin/pip install ninja python-bidi

# 4. paddleocr (requirements.txt보다 먼저 → protobuf 고정 전에 의존성 풀기)
RUN /opt/venv/bin/pip install paddleocr==2.7.3

# 5. 기본 의존성 (protobuf 버전 마지막에 고정)
COPY requirements.txt ./
RUN /opt/venv/bin/pip install -r requirements.txt

# ──────────────────────────────────────────
FROM base AS runtime
#    ^^^^ devel base를 그대로 사용 (libcudnn.so 완전히 포함됨)

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-distutils \
    tesseract-ocr \
    tesseract-ocr-kor \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libreoffice \
    default-jre \
    libxrender1 \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY . /app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]