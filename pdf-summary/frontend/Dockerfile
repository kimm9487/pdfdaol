# 수정 전: FROM node:18-alpine
# 수정 후: 최신 안정 버전인 20 또는 22를 사용합니다.
FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
CMD ["npm", "run", "dev", "--", "--host"]

