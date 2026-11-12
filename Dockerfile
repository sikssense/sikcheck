# Playwright 공식 이미지: Chromium과 필요한 시스템 라이브러리가 들어 있다
FROM mcr.microsoft.com/playwright:v1.65.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3100
# 검수 기록 DB와 스냅샷은 /app/data 볼륨에 남긴다
VOLUME ["/app/data"]
CMD ["npm", "start"]
