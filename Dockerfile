# Uzak (HTTP) sürüm için imaj. Derleme ve çalışma aşamaları ayrı; son imajda TypeScript ve dev bağımlılıkları yok.
FROM node:22-alpine AS derleme
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=derleme /app/build ./build
COPY data ./data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://localhost:${PORT}/saglik" || exit 1
CMD ["node", "build/http.js"]
