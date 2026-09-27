# Debian (not Alpine): @napi-rs/canvas and tesseract.js need glibc and
# fontconfig for PDF rasterization and OCR (see ADR of the ingestion pipeline
# in docs/architecture-decisions.md). Single image runs both the API and the
# job-queue worker pool in one process (ADR-02), matching the free-tier
# single-container hosts (Hugging Face Spaces, Render) in docs/deployment.md.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY src/db/*.sql ./dist/db/

RUN mkdir -p ./uploads && chown -R node:node ./uploads /app
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD-SHELL curl -f "http://localhost:${PORT:-3001}/health" || exit 1

CMD ["node", "dist/index.js"]
