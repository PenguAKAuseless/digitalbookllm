# Test Plan and Scenarios

Extends the original test scenario set from the requirements specification
(§16.2) with additional cases per module, an explicit UC/FR traceability
column, and pointers to the executable test that implements each scenario
where one exists. See [architecture-decisions.md](./architecture-decisions.md)
for the rationale behind any component substitution referenced here.

## 1. Scope and test levels

| Level | Tooling | Runs against |
|---|---|---|
| Unit | Jest (`backend/tests/unit`), Vitest (`frontend/tests/unit`) | Pure logic, no network/DB |
| Integration | Jest + Supertest (`backend/tests/integration`) | Real PostgreSQL, mocked embedding model |
| Security probe | `backend/eval/security-probes.ts` | A live deployed instance |
| Load | `backend/eval/load-test.ts` (autocannon + concurrent uploads) | A live deployed instance |
| RAG evaluation | `backend/eval/rag-eval.ts` | A live deployed instance, with a seeded golden corpus |
| E2E | Playwright (`frontend/tests/e2e`) | A live deployed instance |

**Out of scope:** correctness of a third-party LLM's output content (only
context-grounding and citation structure are checked), infrastructure of
external LLM providers, and testing on physical mobile devices (responsive
layout is checked at browser viewport widths).

## 2. Running the suites

```bash
# Backend unit + integration (needs a disposable Postgres — see docs/deployment.md)
cd backend && npm run migrate && npm test

# Backend eval scripts, against a running instance
BASE_URL=http://localhost:3001 npm run test:security
BASE_URL=http://localhost:3001 npm run test:load
BASE_URL=http://localhost:3001 npm run eval:rag

# Frontend unit
cd frontend && npm test

# Frontend E2E, against a running frontend + backend
cd frontend && npm run test:e2e
```

## 3. Document & async pipeline (Document, Ingestion, OCR)

| ID | UC/FR | Scenario | Steps | Expected result | Test |
|---|---|---|---|---|---|
| TC-DOC-01 | UC05, FR03 | Upload a text-based PDF | Drag a text-layer PDF into the library | `202 Accepted`, document appears with status `UPLOADED` then `PROCESSING` | `tests/e2e/upload-and-read.spec.ts` |
| TC-DOC-02 | UC07, FR04 | Background ingestion completes | Wait after TC-DOC-01 | Job queue claims `INGEST_DOCUMENT`; chunks with embeddings are written; status becomes `READY` | `tests/integration/highlights.test.ts` (upload fixture) |
| TC-DOC-03 | UC07, NFR03.1 | OCR fallback for an image-only PDF | Upload a scanned (no text layer) PDF | Ingestion falls back to OCR; `ocr_used=true`; status reaches `READY` or `FAILED` with a clear `status_detail`, never hangs in `PROCESSING` | Manual + `queue/handlers/ingest.ts` code path |
| TC-DOC-04 | FR04 | Two-level chunking produces topic-coherent chunks | Ingest a document with two unrelated paragraphs merged in one paragraph block | Semantic refinement splits at the topic boundary | `tests/unit/chunker.test.ts` |
| TC-DOC-05 | FR03 | Unsupported file type is rejected | Upload a `.zip` file | `400` before any job is enqueued | Manual |
| TC-DOC-06 | NFR02.2 | Upload never blocks the API thread | Upload a large PDF (>50MB) | Request returns `202` immediately; ingestion proceeds asynchronously | `documentService.uploadDocument` (buffers to storage, enqueues, returns) |
| TC-DOC-07 | UC06 | Delete a document | Delete a `READY` document | Document, its chunks, highlights, and stored files are removed; a second `GET` returns `404` | Manual |
| TC-DOC-08 | ADR-09 | Cover thumbnail generated once | Inspect a `READY` PDF document | `cover_key` set; `/documents/:id/cover` returns a signed/streamable image URL | Manual smoke test (see §8) |
| TC-DOC-09 | ADR-09 | Progressive file loading | Request `/documents/:id/file` then fetch with a `Range` header | Response is `206 Partial Content` with a correct `Content-Range` | Manual smoke test (see §8) |

## 4. Reading experience (UI/UX)

| ID | UC/FR | Scenario | Steps | Expected result | Test |
|---|---|---|---|---|---|
| TC-READ-01 | UC08, FR08 | Virtualized render on a long document | Open a 1000+ page PDF, scroll end to end | Initial paint < 3s; only pages within the overscan window are mounted; scrolling stays smooth | Manual (needs a large fixture) |
| TC-READ-02 | UC11 | Contextual popover appears on selection | Select text in the viewer | Popover with Highlight / Note / Speak / Ask AI appears above the selection | `frontend/tests/unit/selection-popover.test.tsx` (component-level); E2E pending a PDF fixture |
| TC-READ-03 | UC11 | Highlight persists across reload | Highlight a passage, reload the page | Same passage renders highlighted at the same location after reload | `tests/integration/highlights.test.ts` (API-level persistence) |
| TC-READ-04 | UC10 | Bookmark a page | Create a `BOOKMARK` highlight with no content | Appears in the sidebar's Highlights tab; clicking it jumps to that page | `tests/integration/highlights.test.ts` |
| TC-READ-05 | UC09 | Zoom controls | Click zoom in/out in the bottom toolbar | Page scale changes; layout does not break | Manual |
| TC-READ-06 | UC08 | Table of contents navigation | Click a TOC entry | Viewer scrolls to the corresponding page | Manual (depends on the source PDF having an outline) |
| TC-READ-07 | UC12, FR09 | Text-to-speech streaming | Click Speak on a selection | Audio starts before the full utterance is synthesized when a TTS provider is configured; falls back to `SpeechSynthesis` otherwise | Manual (ADR-08) |
| TC-READ-08 | 6.3 | Responsive layout | Resize viewport to 375px width | Sidebar collapses to an overlay; split-pane stacks reader above chat | Manual |
| TC-READ-09 | ADR-10 | Language switch | Toggle vi/en in the header | All translated strings change immediately; preference persists after reload | `frontend/tests/unit/messages.test.ts` (catalogue completeness) |

## 5. AI interaction & RAG

| ID | UC/FR | Scenario | Steps | Expected result | Test |
|---|---|---|---|---|---|
| TC-AI-01 | UC14, FR07 | Contextual QA with hard context | Select text, click Ask AI, ask "Summarize this" | Chat focuses; selection shown as a quoted chip; answer engages with the selected passage | Manual + `ragController.queryStream` (selectedText always injected) |
| TC-AI-02 | NFR02.1 | Streaming TTFB | Ask a question expecting a long answer | First byte arrives in < 2s; text streams incrementally, not all at once | `eval/rag-eval.ts` (`latency.ttfbP95Ms`) |
| TC-AI-03 | UC13 | Citation card click scrolls the viewer | Ask a global question, click a citation chip | Reader pane scrolls to the cited page | Manual (frontend wiring in `ChatPanel`/`VirtualPageViewer`); E2E pending a PDF fixture |
| TC-AI-04 | FR05 | Retrieval recall | Ask questions with known answers in a seeded corpus | Retrieved citations contain the expected facts | `eval/rag-eval.ts` (`retrieval.recallAtK`) |
| TC-AI-05 | ADR-07 | LLM provider failover | Disable the first configured provider (invalid key), leave a later one valid | Router skips the unhealthy provider and completes the request without a client-visible error | `tests/unit/openAiCompatibleProvider.test.ts` (provider-level); router-level failover verified manually against `/api/system/llm-status` |
| TC-AI-06 | ADR-07 | No provider configured | Unset every provider key | `/api/rag/query` streams a clear `error` event; the API never 500s | Manual |
| TC-AI-07 | NFR02.2 | Daily quota enforcement | Exceed `MAX_QUERIES_PER_DAY` for one user | Further queries return `429` for that user only; other users are unaffected | Manual (extends `ragService.checkRateLimit`) |
| TC-AI-08 | FR07 | No hallucination beyond context | Ask a question with no relevant document uploaded | Response states no relevant document was found; no citations | `ragController.queryStream` (empty-citation branch) |

## 6. Personalization (Knowledge Graph)

| ID | UC/FR | Scenario | Steps | Expected result | Test |
|---|---|---|---|---|---|
| TC-KG-01 | UC15, FR06 | Entities extracted from a chat exchange | Chat about a concept, open Graph Mode | A node for that concept appears, scoped to the current user | Manual (requires a configured LLM provider) |
| TC-KG-02 | FR06 | Extraction never blocks the chat response | Chat while entity extraction is running | Chat response streams normally regardless of extraction worker load | `queue/handlers/extractEntities.ts` runs as a separate enqueued job |
| TC-KG-03 | UC15 | Node detail panel | Click a node in the graph | Panel shows description and related nodes with source excerpts | `graphService.getEntityDetail` (integration coverage pending a seeded graph fixture) |
| TC-KG-04 | NFR04.1 | Graph is tenant-isolated | User B queries `/api/graph` | Only user B's own entities/edges are returned, never user A's | Extends `security-idor.test.ts` pattern (same `user_id` filter as every other resource) |

## 7. Security & performance

| ID | UC/FR | Scenario | Steps | Expected result | Test |
|---|---|---|---|---|---|
| TC-SEC-01 | FR01, NFR04.1 | IDOR on workspaces | User B requests/edits/deletes user A's workspace by id | `403`/`404`, never the resource | `tests/integration/security-idor.test.ts`, `eval/security-probes.ts` |
| TC-SEC-02 | FR01, NFR04.1 | IDOR on documents and highlights | User B lists/creates highlights on user A's document | `403`/`404` | `tests/integration/highlights.test.ts` |
| TC-SEC-03 | FR02 | Expired/malformed JWT rejected | Call any protected route with a garbage token | `401` | `tests/integration/security-idor.test.ts` |
| TC-SEC-04 | NFR04.1 | Vector retrieval is tenant-scoped | Query workspace A's chunks while authenticated as user B | Query returns no cross-tenant chunks (enforced by `user_id` filter in `VectorRetrievalService`) | Code-level guarantee; extend integration suite when embeddings are mocked for chat tests |
| TC-SEC-05 | — | Rate limiting on the API surface | Exceed 100 requests / 15 min from one client | `429 Too Many Requests` | Manual (`express-rate-limit` config) |
| TC-PERF-01 | NFR02.2 | Concurrent upload burst | 6-10 simultaneous uploads | All return `200`/`202`; API process does not crash; jobs drain from the queue | `eval/load-test.ts` |
| TC-PERF-02 | — | Baseline read throughput | 10 concurrent connections against `GET /api/workspaces` for 5s | Zero errors/timeouts; p99 latency reported | `eval/load-test.ts` |
| TC-PERF-03 | NFR01.2 | No client-side vector storage | Inspect browser storage after a chat session | No embeddings or graph data in `localStorage`/`IndexedDB` | Manual (code review: only auth token and UI prefs are persisted client-side) |

## 8. Manual smoke-test log

Performed once against a local instance (real Postgres, local storage driver,
no LLM key configured) as part of this delivery:

| Check | Result |
|---|---|
| Register → login → `/auth/me` | Pass |
| Create workspace → upload a real-world PDF (26 pages) | `READY` in ~3s, `page_count=26`, no OCR needed |
| Cover thumbnail generated and served | Pass (`200`, PNG) |
| Range request on the PDF file | Pass (`206 Partial Content`, correct `Content-Range`) |
| Create/list a highlight on the ingested document | Pass |
| IDOR probes (`eval/security-probes.ts`) | 6/6 passed |
| Concurrent upload burst, n=6 | 6/6 accepted, ~144ms |
| Baseline throughput, 10 connections/5s | 0 errors, ~1200 req/s, p99 150ms |
| RAG retrieval recall@k on a 4-question golden set | 100%, TTFB p95 ~29ms (generation skipped — no provider key in this environment) |
| Scanned/malformed PDF → OCR path executes end-to-end | Pass (pdf.js rasterization + tesseract.js run without crashing; correctly resolves to `FAILED` with a clear message when no text is recoverable) |

## 9. Traceability summary

Every UC and FR in the requirements specification has at least one scenario
above. NFR04.1 (IDOR) and NFR02.1/NFR02.2 (streaming, queueing) carry the
most scenarios, reflecting their P0 risk ranking. Scenarios marked "Manual"
are executable by a human tester against a running deployment following the
steps given; automating them further (large-PDF fixtures, a configured LLM
key, a seeded knowledge graph) is listed as follow-up work rather than
blocking delivery.
