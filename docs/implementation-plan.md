# Implementation Plan

Working plan for the DigitalBookLLM rebuild. See [architecture-decisions.md](./architecture-decisions.md)
for why each infrastructure substitution was made. This file tracks scope, file
layout, data model, and delivery order; it is a living checklist, updated as
phases complete.

## Delivery phases

1. **Backend core** — schema migration, job queue, storage abstraction, LLM
   provider router with health checks.
2. **Backend domain features** — ingestion pipeline (extract → OCR → chunk →
   embed), highlights/bookmarks, RAG chat with SSE streaming + citations,
   knowledge-graph extraction worker + query API, TTS streaming endpoint.
3. **Frontend** — layout shell (header, sidebar, view-mode switcher), library
   with drag-drop upload + progressive preview, split-pane reader (virtualized
   viewer + contextual popover + chat pane with citations), knowledge graph
   explorer, settings (theme, language, font).
4. **i18n** — vi/en message catalogue, language switcher, persisted preference.
5. **Testing** — unit, integration, security (IDOR), load/concurrency, RAG
   evaluation harness (retrieval recall@k, citation accuracy, TTFB), Playwright
   E2E for the core UI flows.
6. **Deployment** — Dockerfile for API+worker, Vercel config for client, Supabase
   provisioning script, environment templates, deploy runbook.
7. **Documentation** — README, architecture, API reference, setup guide, test
   report, user guide.

## Backend layout (`backend/src`)

```
config/            env loading, provider priority config
db/                pool, schema.sql, migrate.ts
storage/           StorageDriver interface; supabase.ts, local.ts drivers
queue/             jobs table client, worker pool runner, job handlers
  handlers/ingest.ts        extract text -> OCR fallback -> chunk -> embed
  handlers/extractEntities.ts  entity/relation extraction -> graph tables
llm/
  providers/        one adapter per provider (cerebras, sambanova, openai,
                     anthropic, mistral, openrouter, azure-openai, gemini, groq)
  router.ts         priority list + health probe cache + failover dispatch
  embeddings.ts      embedding provider (Gemini embeddings, ONNX fallback)
ocr/               tesseract wrapper, page-image rasterization
chunking/          structural splitter + semantic boundary pass
tts/               streaming synth proxy (edge-tts) + provider fallback flag
controllers/       one per resource, thin: validate -> service -> respond
services/          business logic, DB access, ownership checks
middleware/        auth, error handler, rate limit (per-identity), validation
routes/            REST route wiring
realtime/          SSE helper for chat streaming
types/             shared request/response contracts
```

## Data model (PostgreSQL, all tables carry `user_id` for tenant isolation)

- `users` (id, email, password_hash, created_at)
- `workspaces` (id, user_id, name, description, timestamps)
- `documents` (id, workspace_id, user_id, title, author, file_type, file_size,
  storage_key, cover_key, status enum, page_count, created_at, updated_at)
- `chunks` (id, document_id, chunk_index, page_number, text, embedding vector(384))
- `highlights` (id, document_id, user_id, type enum[HIGHLIGHT,BOOKMARK], content,
  note, color, location_meta jsonb, created_at)
- `chat_sessions` (id, workspace_id, document_id, user_id, title, timestamps)
- `chat_messages` (id, session_id, role, content, selected_text, citations jsonb,
  provider, created_at)
- `entities` (id, user_id, name, type, description, created_at)
- `entity_relations` (id, source_entity_id, target_entity_id, relation_type,
  source_document_id, created_at)
- `jobs` (id, type, payload jsonb, status enum, attempts, run_after, error,
  created_at, updated_at) — the queue table (ADR-02)
- `user_sessions` (id, queries_today, last_reset_date) — daily AI quota

## API surface (new/changed vs. legacy)

```
POST   /api/auth/register | login          (unchanged)
GET    /api/auth/me

GET/POST/PUT/DELETE /api/workspaces        (unchanged)

POST   /api/documents/upload               -> 202 + job id, status polling
GET    /api/documents?workspaceId=
GET    /api/documents/:id
GET    /api/documents/:id/status           NEW - ingestion progress
GET    /api/documents/:id/file             signed URL redirect
GET    /api/documents/:id/preview          NEW - first-pages progressive stream
DELETE /api/documents/:id

GET/POST/DELETE /api/documents/:id/highlights   NEW (UC10, UC11)

POST   /api/rag/query                      SSE stream, citations in payload
POST   /api/rag/query/workspace            SSE stream

GET    /api/graph                          NEW - nodes+edges for a user/workspace
GET    /api/graph/:entityId                NEW - node detail + source excerpts

POST   /api/tts/stream                     NEW - streamed audio (FR09)

GET    /api/system/llm-status              NEW - provider health, for diagnostics
```

## LLM router priority (ADR-07)

`operator providers (env-enabled, in listed order) -> Gemini -> Groq`, each
candidate health-checked with a cached short-TTL probe before dispatch; mid-stream
failure triggers one failover attempt to the next candidate.

## Frontend layout (`frontend`)

```
app/
  (auth)/login, register
  (app)/library                 dashboard grid + upload + preview overlay
  (app)/workspace/[id]/book/[documentId]   split-pane reader
  (app)/workspace/[id]/graph               knowledge graph explorer
components/
  reader/                virtualized page viewer, TOC, page nav, zoom
  reader/popover.tsx      contextual toolbar (Highlight/Note/Speak/Ask AI)
  chat/                   chat pane, citation chip, prompt suggestions
  graph/                  React Flow canvas, node detail panel
  library/                grid card, upload dropzone, progress bar
  layout/                 header, sidebar, view-mode switcher
lib/
  i18n/                   catalogue (vi, en), provider, hook
  api/                    typed fetch clients per resource
```

Responsive rule: single-column stacked layout (reader above chat, collapsible
sidebar as a sheet) below 768px; split-pane with draggable divider above it.

## Testing plan

- **Unit** (Vitest): chunking boundaries, LLM router failover, ownership guards,
  job queue claim/retry logic.
- **Integration** (Supertest against a test Postgres): auth, workspace/document
  CRUD, highlights, RAG query citation shape, graph query.
- **Security**: IDOR probe script (TC-SEC-01 family) across every resource type.
- **Load**: autocannon/k6 script simulating concurrent uploads (TC-PERF-01),
  asserting 200/202 responses and queue drain.
- **RAG evaluation harness**: golden Q/A set -> retrieval recall@k, citation
  correctness, generation faithfulness, TTFB distribution.
- **E2E** (Playwright): upload -> ready, popover -> highlight persists after
  reload, contextual chat -> citation click scrolls viewer, graph node opens
  detail panel.

Full traceability table (UC/FR -> test case ID) lives in `docs/test-scenarios.md`.

## Deployment

Docker image for API+worker (single process, ADR-02), deployed to Hugging Face
Spaces (primary) and Render (standby); Vercel for the Next.js client; Supabase
for Postgres+pgvector+Storage. Full steps in `docs/deployment.md`.
