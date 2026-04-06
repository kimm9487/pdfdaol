FROM nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04 AS base

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

#  torch (CUDA 12.1 wheel)
RUN /opt/venv/bin/pip install \
    torch==2.1.0 \
    torchvision==0.16.0 \
    --index-url https://download.pytorch.org/whl/cu121

# paddlepaddle-gpu (torch와 분리)
RUN /opt/venv/bin/pip install paddlepaddle-gpu==2.6.1 \
    -f https://www.paddlepaddle.org.cn/whl/linux/mkl/avx/stable.html

#  easyocr (--no-deps로 torch 재설치 방지)
RUN /opt/venv/bin/pip install easyocr==1.7.1 --no-deps && \
    /opt/venv/bin/pip install ninja python-bidi

#  paddleocr (requirements.txt보다 먼저  protobuf 고정 전에 의존성 풀기)
RUN /opt/venv/bin/pip install paddleocr==2.7.3

#  pororo OCR (yunwoong7 bundled build — pip install pororo는 torch==1.6.0 강제하므로 사용 불가)
#    대신 소스에서 OCR 전용 패키지만 venv site-packages에 직접 복사
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/yunwoong7/korean_ocr_using_pororo.git /tmp/kor_pororo \
    && PYVER=$(/opt/venv/bin/python -c "import sys; print(f'python{sys.version_info.major}.{sys.version_info.minor}')") \
    && cp -r /tmp/kor_pororo/pororo /opt/venv/lib/${PYVER}/site-packages/pororo \
    && rm -rf /tmp/kor_pororo
RUN /opt/venv/bin/pip install wget scikit-image

COPY requirements.txt ./
RUN /opt/venv/bin/pip install -r requirements.txt

# ──────────────────────────────────────────
FROM base AS runtime

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