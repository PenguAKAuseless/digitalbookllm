# DigitalBookLLM Backend

Express and TypeScript API for document ingestion and prioritized RAG.

## Run Locally

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

API URL: http://localhost:3001

## Docker

```bash
docker-compose up -d
docker-compose -f docker-compose.dev.yml up
```

## Endpoints

- `POST /api/documents/upload`
- `GET /api/documents`
- `GET /api/documents/:id`
- `GET /api/documents/:id/pdf`
- `DELETE /api/documents/:id`
- `POST /api/rag/query`
- `GET /api/rag/history/:documentId`
- `GET /api/rag/query-count`
- `GET /health`

## Database

- Schema: `src/db/schema.sql`
- Migration: `npm run migrate`
- pgvector extension is required

## Build and Test

```bash
npm run build
```
