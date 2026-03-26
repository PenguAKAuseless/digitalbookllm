# DigitalBookLLM

DigitalBookLLM is a local-first document learning application with prioritized RAG, document chat, and browser-based text-to-speech for assistant responses.

## Features

- Document upload and indexing for PDF, DOCX, TXT, and Markdown
- Prioritized RAG with selected text as primary context
- pgvector-based semantic retrieval in PostgreSQL
- Chat history and per-user daily query limits
- Browser-native text-to-speech for assistant messages
- Local fine-tuning pipeline for LoRA adapters

## Quick Start

1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run dev
```

2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Application URL: http://localhost:3000

## Database

- PostgreSQL with pgvector is required.
- Default schema and indexes are in `backend/src/db/schema.sql`.
- Migration entrypoint: `backend/src/db/migrate.ts`.

## Documentation

- Setup guide: `documentation/setup.md`
- System architecture: `documentation/architecture.md`
- Implementation notes: `documentation/implementation.md`
- RAG approach: `documentation/priority-rag.md`
- Local fine-tuning pipeline: `documentation/pipelines/finetune/README.md`

## Project Layout

```text
backend/        Express + TypeScript API
frontend/       Next.js application
documentation/  Architecture, setup, RAG, and model pipeline docs
```

## Verification Commands

```bash
cd backend && npm run build
cd frontend && npm run build
```

## License

MIT
