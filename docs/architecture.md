# Architecture

Implementation of the architecture specified in the requirements document,
with the free-tier deployment substitutions recorded in
[architecture-decisions.md](./architecture-decisions.md). Read that file for
the *why*; this file covers the *what*.

## System overview

```
┌─────────────┐     REST + SSE      ┌──────────────────────────┐
│  Next.js    │ ◄─────────────────► │  Express API (Node/TS)    │
│  client     │                     │  + in-process job queue   │
│  (Vercel)   │                     │  (HF Spaces / Render)      │
└─────────────┘                     └──────────────┬────────────┘
                                                     │
                              ┌──────────────────────┼──────────────────────┐
                              ▼                      ▼                      ▼
                     ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐
                     │ PostgreSQL       │   │ Supabase Storage │   │ LLM providers    │
                     │ + pgvector       │   │ (documents,      │   │ (health-checked, │
                     │ (relational data,│   │  cover images)   │   │  priority order)  │
                     │  vectors, graph, │   └──────────────────┘   └──────────────────┘
                     │  job queue)      │
                     └─────────────────┘
```

## Request paths

- **CRUD** (auth, workspaces, documents, highlights, graph queries): synchronous REST, JSON in/out.
- **Chat** (`POST /api/rag/query`): Server-Sent Events. Citations are emitted
  as soon as retrieval completes, then answer tokens stream as the LLM
  produces them, then a `done` event with the persisted message id.
- **Ingestion** (`POST /api/documents/upload`): returns `202` immediately;
  the actual extract → OCR-fallback → chunk → embed pipeline runs in a
  background job. The client polls `GET /api/documents/:id/status`.
- **Knowledge extraction**: enqueued after ingestion completes and after
  every chat exchange; never blocks either path.

## Async job queue

A `jobs` table in PostgreSQL, claimed with `SELECT ... FOR UPDATE SKIP
LOCKED` by a bounded worker pool running in the same process as the API
(`backend/src/queue/`). Two job types:

- `INGEST_DOCUMENT` — `queue/handlers/ingest.ts`
- `EXTRACT_ENTITIES` — `queue/handlers/extractEntities.ts`

Failed jobs retry with exponential backoff up to `max_attempts`, then move to
`DEAD` with the last error recorded — queryable directly with SQL for
operational visibility.

## Data model

```
users
  └── workspaces
        └── documents ── chunks (vector(384), page_number)
        │       └── highlights (HIGHLIGHT | BOOKMARK, location_meta JSON)
        └── chat_sessions
                └── chat_messages (citations JSONB)
  └── entities ── entity_relations   (personal knowledge graph, ADR-04)
jobs                                  (async queue, ADR-02)
```

Every table that holds user data carries `user_id` (or reaches it via a
foreign key one hop away), and every data-access method in
`backend/src/services/*` filters by it — this is the mechanism behind
NFR04.1 (tenant isolation / IDOR prevention), not a single central guard.

## Ingestion pipeline

1. **Extract** (`ingestion/extractText.ts`): `pdf-parse` for PDFs (capturing
   per-page text so chunks can carry a `page_number`), `mammoth` for DOCX,
   raw UTF-8 for plain text/Markdown.
2. **OCR fallback** (`ocr/`): triggered only when step 1 yields no usable
   text. Renders each page to a PNG with pdf.js + `@napi-rs/canvas`, then
   recognizes it with `tesseract.js` (`eng+vie`). Accepted error rate per
   NFR03.1.
3. **Chunk** (`chunking/chunker.ts`): structural split (paragraph → sentence
   → hard wrap, with overlap) then semantic refinement (adjacent sentences
   re-split wherever their embedding cosine distance exceeds a threshold) —
   the two-level chunking FR04 specifies.
4. **Embed**: each chunk embedded locally (`llm/embeddings.ts`,
   Xenova/all-MiniLM-L6-v2, 384-dim, no external quota) and stored with its
   page number.
5. **Cover**: page 1 rasterized once and stored as the library thumbnail.

## LLM router

`llm/router.ts` holds an ordered list of providers (`llm/providers/*`), each
exposing `isConfigured()`, `checkHealth()`, `generate()`, and
`generateStream()`. On every request the router:

1. Filters to configured providers, in priority order (operator-configured →
   Gemini → Groq — see ADR-07).
2. Skips any whose cached health probe (30s TTL) reports unhealthy.
3. Dispatches to the first healthy candidate; on a pre-stream failure it
   tries the next one. `GET /api/system/llm-status` reports live status for
   every configured provider.

## API surface

Full route list in each `backend/src/routes/*.ts` file; the notable
non-CRUD endpoints:

| Route | Behavior |
|---|---|
| `POST /api/documents/upload` | `202` + job id; async ingestion |
| `GET /api/documents/:id/status` | Poll target for ingestion progress |
| `GET /api/documents/:id/file` | Signed/range-capable URL for the reader |
| `POST /api/rag/query` | SSE: `provider` → `citations` → `delta`* → `done` |
| `GET /api/graph`, `GET /api/graph/:entityId` | Personal knowledge graph |
| `POST /api/tts/stream` | Streamed audio, or `503` (client falls back to `SpeechSynthesis`) |
| `GET /api/system/llm-status` | Provider health diagnostics |

## Frontend structure

```
app/library                          — workspace + document dashboard, upload
app/workspace/[id]/book/[docId]       — split-pane reader
app/workspace/[id]/graph              — knowledge graph explorer
components/reader/                    — virtualized viewer, selection popover, TOC/highlights sidebar
components/chat/                      — SSE chat pane, citation chips
components/graph/                     — React Flow canvas, entity detail panel
lib/i18n/                             — vi/en catalogue (ADR-10)
```

The document viewer (`components/reader/virtual-page-viewer.tsx`) mounts
only pages within an overscan window around the current page (FR08); every
other page keeps its measured height so scroll position stays correct
without rendering. Text selection is resolved to normalized (0–1) rectangles
relative to the page element, so highlights re-render correctly at any zoom
level or screen size.
