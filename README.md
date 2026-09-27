# DigitalBookLLM

An AI-assisted eBook reader: upload a PDF/EPUB/DOCX, read it in a virtualized
split-pane viewer, highlight and bookmark passages, ask an AI assistant
questions grounded in the document (with citation cards linking back to the
source page), and watch a personal knowledge graph grow from your reading and
chat history.

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System design, data model, request paths |
| [docs/architecture-decisions.md](docs/architecture-decisions.md) | Every deviation from the reference architecture, and why |
| [docs/deployment.md](docs/deployment.md) | Step-by-step deploy to Vercel + Hugging Face Spaces/Render + Supabase |
| [docs/test-scenarios.md](docs/test-scenarios.md) | Full test plan, scenario-by-scenario, mapped to use cases |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Delivery phases and file layout |

## Project layout

```
backend/    Express + TypeScript API, PostgreSQL job queue, LLM router, OCR/chunking pipeline
frontend/   Next.js client — library, split-pane reader, chat, knowledge graph
docs/       Architecture, deployment, and test documentation
_archive/   Superseded material kept for reference only (see _archive/README.md)
```

## Local development

**Option A — everything in Docker** (Postgres + backend + frontend, one command):

```bash
cp .env.example .env
cp backend/.env.example backend/.env   # fill in at least one LLM provider key
docker compose up --build
# frontend: http://localhost:3000, API: http://localhost:3001
```

**Option B — run each side natively** (faster iteration, needs Node 20+ and a
local Postgres with the `vector` extension):

```bash
# Backend
cd backend
cp .env.example .env        # fill in at least one LLM provider key
docker compose up -d postgres   # or point DB_* at any Postgres with pgvector
npm install
npm run migrate
npm run dev                  # http://localhost:3001

# Frontend
cd frontend
npm install
npm run dev                  # http://localhost:3000
```

Without any object-storage credentials configured, the backend stores files
on local disk; without any LLM provider key, chat requests fail with a clear
error while everything else (upload, reading, highlights, search) keeps
working.

## Testing

```bash
cd backend && npm test              # unit + integration (Jest/Supertest)
cd backend && npm run test:security # IDOR probe against a running instance
cd backend && npm run test:load     # concurrency + throughput
cd backend && npm run eval:rag      # retrieval recall@k, TTFB

cd frontend && npm test             # unit (Vitest)
cd frontend && npm run test:e2e     # E2E (Playwright, needs a running stack)
```

See [docs/test-scenarios.md](docs/test-scenarios.md) for the full scenario
list and what each maps to.

## Deployment

See [docs/deployment.md](docs/deployment.md). Summary: Vercel (frontend),
Hugging Face Spaces as the primary API host with Render as a standby (both
free, Docker-based), Supabase for PostgreSQL+pgvector and object storage.

## License

MIT
