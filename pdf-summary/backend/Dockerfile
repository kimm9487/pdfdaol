# 1. Python 3.9 기반 이미지 사용
FROM python:3.9-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 리눅스 시스템 필수 도구 설치 (bcrypt 설치 시 필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    tesseract-ocr \
    tesseract-ocr-kor \
    poppler-utils \
    libgl1 \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

# 4. 요구 패키지 복사 및 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir --force-reinstall "uvicorn[standard]==0.39.0"
RUN pip install --no-cache-dir --force-reinstall typing_extensions==4.15.0
RUN pip install --no-cache-dir --force-reinstall typing-inspection==0.4.2
RUN pip install --no-cache-dir --force-reinstall pydantic==2.7.4

# 5. 현재 폴더의 모든 소스 코드 복사
COPY . .

# 6. 서버 실행 (python main.py 방식 유지)
CMD ["python", "main.py"]

