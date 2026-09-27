# Architecture Decision Record

This document records every point where the delivered system diverges from the
architecture described in the requirements specification, together with the
rationale and the impact on the specified requirements. Each entry is written so
it can be transcribed directly into the design chapter of the report.

The governing constraint across all decisions: **the system must be publicly
deployable on permanently free hosting tiers.** The specified topology
(FastAPI + Celery + RabbitMQ + PostgreSQL + Qdrant/Pinecone + Neo4j + S3 + Nginx)
has no jointly-free managed hosting path. Each decision below preserves the
*logical* architecture — layer boundaries, data isolation, async processing,
streaming — while substituting a component that is free to operate.

---

## ADR-01 — Application runtime: Node.js / Express instead of Python / FastAPI

**Specified:** Main API Server implemented in FastAPI (Python), chosen for
async I/O performance when working with LLMs.

**Delivered:** Express on Node.js 20, written in TypeScript.

**Rationale:**
- Node.js provides the same non-blocking, event-loop I/O model that motivated the
  FastAPI choice. For a workload that is almost entirely network-bound (LLM calls,
  database round-trips, object storage), the two are equivalent in throughput.
- A single language across client and server removes the duplicated type
  definitions that a Python API and a TypeScript client would otherwise require.
  Request and response contracts are declared once and imported by both sides.
- The deployment image is smaller, which matters on a 512 MB free container.

**Requirement impact:** None. The asynchronous-I/O property asserted in the
architecture section is preserved; only the runtime name changes.

**Report edit:** In *4. Thiết kế kiến trúc hệ thống → B. API & Routing Layer*,
replace "Main API Server (FastAPI - Python)" with "Main API Server (Express -
Node.js/TypeScript)" and restate the justification as event-loop based
non-blocking I/O with a unified type system across client and server.

---

## ADR-02 — Job queue: PostgreSQL-backed queue instead of RabbitMQ + Celery

**Specified:** Message Broker (RabbitMQ or Redis) feeding Celery workers, so that
concurrent uploads and knowledge-extraction requests queue rather than
overwhelming the API server (NFR02.2).

**Delivered:** A durable job queue held in a PostgreSQL `jobs` table, consumed by
a bounded in-process worker pool using `SELECT ... FOR UPDATE SKIP LOCKED`.

**Rationale:**
- `SKIP LOCKED` is the standard PostgreSQL primitive for competing consumers. It
  gives atomic claim, retry with backoff, and a dead-letter state — the properties
  NFR02.2 actually requires.
- No free tier provides a managed broker with adequate quota. CloudAMQP's free
  plan caps message volume, and Upstash Redis bills per command, which a polling
  queue consumes rapidly.
- Job state becomes queryable with ordinary SQL, so upload progress
  (`UPLOADED → PROCESSING → READY / FAILED`) is read from the same transaction
  boundary as the document row. With an external broker this requires a separate
  progress channel.
- The queue survives process restarts. An in-memory queue would not, and free
  containers restart frequently.

**Requirement impact:** NFR02.2 is satisfied. Back-pressure is enforced by the
worker-pool concurrency limit; excess work accumulates in the table instead of
saturating the API process. The worker pool is a separate module with no shared
state beyond the database, so it can be extracted into its own process — or
replaced by Celery — without touching the producers.

**Report edit:** In *C. Async Worker Layer*, replace "Message Broker (RabbitMQ
hoặc Redis)" with "Durable job queue (PostgreSQL `jobs` table, `FOR UPDATE SKIP
LOCKED`)" and "Celery Workers" with "Worker pool (bounded concurrency)". Keep
Worker 1 (Ingestion) and Worker 2 (Knowledge Extraction) as specified — both are
implemented.

---

## ADR-03 — Vector storage: pgvector instead of Qdrant / Pinecone

**Specified:** Dedicated cloud vector database (Qdrant or Pinecone), chosen for
high-speed similarity search with metadata filtering.

**Delivered:** The `pgvector` extension inside the primary PostgreSQL instance,
with an HNSW index and a `vector_cosine_ops` operator class.

**Rationale:**
- Metadata filtering — the specific capability the specification cites — is a
  `WHERE` clause on indexed columns (`user_id`, `document_id`, `page_number`).
  Tenant isolation is therefore enforced by the same mechanism that protects
  every other table, rather than by a payload filter in a second system.
- HNSW in pgvector delivers sub-50 ms recall on corpora several orders of
  magnitude larger than this workload.
- Eliminating the second datastore removes a network hop from the retrieval path,
  removes a second failure mode, and removes the dual-write consistency problem
  between chunk rows and vector points.

**Requirement impact:** FR05 is satisfied in full. NFR01.2 (all vectors stored
server-side, never on the client) is satisfied.

**Report edit:** In *D. Storage Layer*, replace the "Vector DB (Qdrant hoặc
Pinecone)" bullet with "Vector store (PostgreSQL + pgvector, HNSW index)".
In *5.2*, the logical point structure is unchanged — `id`, `vector`, and the
payload fields become columns on the `chunks` table, and the same metadata
filters apply.

---

## ADR-04 — Knowledge graph: relational property graph instead of Neo4j

**Specified:** Neo4j managing the evolving knowledge graph, modelled as a
property graph with `Entity` nodes and `RELATED_TO` relationships.

**Delivered:** The identical property-graph model expressed as two PostgreSQL
tables, `entities` and `entity_relations`, with recursive CTEs for traversal.

**Rationale:**
- Neo4j AuraDB Free **automatically pauses an instance after three days of
  inactivity** and requires manual resumption. For a system whose value is a
  permanently reachable public URL, this is a defect, not a limitation.
- The traversals this application performs are shallow — the graph explorer
  renders a one- or two-hop neighbourhood around a selected node. Recursive CTEs
  serve this with no measurable penalty at the specified graph scale.
- The graph is written by an async worker in the same transaction that records
  the chat message that produced it, which keeps the graph consistent with its
  provenance.

**Requirement impact:** FR06 and UC15 are satisfied. The stored model is
unchanged: entities carry `id`, `name`, `type`, `description`, `user_id`;
relations carry `relation_type`, `source_document_id`, `created_at`.

**Report edit:** In *D. Storage Layer*, replace "Graph DB (Neo4j)" with
"Property graph (PostgreSQL relational encoding: `entities`, `entity_relations`)".
Section *5.3* needs no structural change — note only that the property-graph model
is stored relationally.

---

## ADR-05 — Object storage: Supabase Storage instead of AWS S3 / MinIO

**Specified:** Object Storage (AWS S3 or MinIO) for the physical document files.

**Delivered:** Supabase Storage, an S3-compatible object store, accessed through a
storage abstraction with a local-filesystem driver used in development and tests.

**Rationale:**
- Both free application hosts provide only ephemeral disk; uploaded files must
  leave the container. Supabase Storage is free, S3-compatible, and already part
  of the account that provides PostgreSQL.
- The storage abstraction exposes `put`, `getSignedUrl`, and `delete`. Migrating
  to S3 or MinIO is a driver swap with no call-site changes.

**Requirement impact:** None. The design intent — files in object storage, links
in the relational database — is preserved.

**Report edit:** In *D. Storage Layer*, replace "AWS S3 hoặc MinIO" with
"Supabase Storage (S3-compatible)".

---

## ADR-06 — Ingress: platform-managed TLS and application rate limiting instead of Nginx

**Specified:** Load Balancer / Reverse Proxy (Nginx or AWS ALB) for traffic
distribution and rate limiting against AI request spam.

**Delivered:** TLS termination and routing are provided by the hosting platforms.
Rate limiting is enforced in application middleware, per authenticated user and
per endpoint class, with a stricter budget on AI endpoints.

**Rationale:**
- Free platforms do not expose a configurable edge proxy; they terminate TLS
  themselves.
- Per-user quotas cannot be expressed at the proxy layer, because the proxy does
  not decode the JWT. The abuse control the specification asks for — limiting AI
  requests — requires identity, so it belongs in the application.

**Requirement impact:** The rate-limiting intent is satisfied and strengthened
(per-identity rather than per-IP). Horizontal load balancing is out of scope at
free tier and is recorded as future work.

**Report edit:** In *B. API & Routing Layer*, replace the Nginx bullet with
"Platform edge (managed TLS, routing) + application-level rate limiting per
authenticated identity, with a stricter budget for AI endpoints".

---

## ADR-07 — LLM access: health-checked provider router

**Specified:** Not covered. The specification assumes an available LLM endpoint.

**Delivered:** A provider router that probes candidate providers for liveness,
caches the result briefly, and dispatches to the first healthy provider in a
configured priority order, with automatic failover mid-request.

Priority order:

1. Operator-supplied providers (Cerebras, SambaNova, OpenAI, Anthropic, Mistral,
   OpenRouter, Azure OpenAI) — enabled by environment variable.
2. Google Gemini free tier — broad quota, strong Vietnamese handling; subject to
   intermittent upstream unavailability.
3. Groq (Llama) — low time-to-first-byte, used as the final fallback.

**Rationale:** Free LLM tiers have no availability guarantee. NFR02.1 sets a
time-to-first-byte target, and a single unavailable provider would breach it.
The router converts an upstream outage into a provider switch.

**Requirement impact:** Supports NFR02.1. Adds an availability property the
specification does not currently state.

**Report edit:** Add to *4. Thiết kế kiến trúc hệ thống* a component "LLM Router"
inside the API layer, described as priority-ordered provider selection with
liveness probing and automatic failover, and add a corresponding non-functional
requirement for AI-provider availability.

---

## ADR-08 — Text-to-speech: server-streamed synthesis with a browser fallback

**Specified:** FR09 — the TTS module calls a third-party API (or a small model)
and streams audio to the client without waiting for full synthesis.

**Delivered:** The API exposes a streaming audio endpoint that proxies a network
speech synthesiser and forwards chunks as they arrive. If no synthesiser is
reachable, the client falls back to the browser `SpeechSynthesis` API.

**Rationale:** Satisfies the streaming requirement where a provider is available,
and keeps UC12 functional when it is not. No free TTS provider offers a
service-level guarantee.

**Requirement impact:** FR09 satisfied, with a documented degraded mode.

**Report edit:** Extend FR09 with "and must degrade to client-side synthesis when
no streaming provider is reachable".

---

## ADR-09 — Document preview and viewer rendering

**Specified:** Section 6.2.B requires a virtualized document viewer. Preview of a
document before or outside the full reading session is not specified.

**Delivered:**

- A single windowed page renderer serves both the library preview and the reading
  pane. Only pages intersecting the viewport plus a small overscan are mounted;
  page canvases are recycled, and text layers are attached only to visible pages.
- The library grid shows a cover thumbnail rendered once at ingestion time and
  stored as an object, so opening the library never loads a PDF.
- Selecting a document opens a preview overlay that streams the first pages while
  the remainder of the file transfers, so the first page is visible before the
  document has fully downloaded.

**Rationale:** Rendering the first page of a large PDF to decide whether to open
it is the most common interaction in the library, and it must not pay the cost of
a full document load.

**Requirement impact:** Satisfies FR08 and extends UC06 with a preview step.

**Report edit:** Add to *6.2.A Màn hình Quản lý Thư viện* a "document preview"
element: cover thumbnail generated at ingestion, and a progressive preview overlay
that renders the first page before the full file has transferred.

---

## ADR-10 — Interface language

**Specified:** Not covered. The specification is written in Vietnamese and
includes a Vietnamese translation prompt in the contextual chat flow.

**Delivered:** A bilingual interface (Vietnamese and English) with a runtime
switcher, backed by a message catalogue. The persisted user preference is applied
before first paint to avoid a language flash. All source code, comments, and
technical documentation are in English.

**Requirement impact:** Additive. No requirement changes.

**Report edit:** Add to *6.1 Bố cục Tổng thể → Profile / Settings* a language
switcher alongside the theme switcher.

---

## ADR-11 — Authentication scope: Email/Password only for this delivery

**Specified:** UC01 lists both Email/Password and OAuth (Google/GitHub) as
registration methods.

**Delivered:** Email/Password with JWT sessions (FR01, FR02). OAuth is not
implemented in this delivery.

**Rationale:**
- OAuth requires registering an app with each provider and configuring a
  callback URL per environment (local, Vercel, each API host in ADR-12's
  deployment table). That configuration is owner-specific and cannot be
  committed to the repository.
- Email/Password alone fully exercises every requirement that depends on
  authentication: tenant isolation (FR01), session expiry (FR02), and the
  IDOR test suite (NFR04.1).

**Requirement impact:** UC01 is partially satisfied — account creation and
session management work end-to-end; the OAuth registration path is not
built. This is the one requirement item in this delivery that is explicitly
deferred rather than substituted.

**Report edit:** In *UC01 - Đăng ký tài khoản*, note that OAuth
(Google/GitHub) is scoped out of this delivery and listed under *Hướng phát
triển* (future work) in the closing chapter; Email/Password registration and
JWT session management are fully implemented and tested.

---

## ADR-12 — Deployment topology

**Specified:** Not covered beyond "Web Application (Client-Server)".

**Delivered:**

| Tier | Platform | Note |
|---|---|---|
| Web client | Vercel | Native Next.js build, global CDN |
| API + workers | Hugging Face Spaces (Docker) — primary | 2 vCPU / 16 GB RAM, no payment method required |
| API + workers | Render (Docker) — standby | Cold start after idle; the client can be repointed by environment variable |
| PostgreSQL + pgvector | Supabase | |
| Object storage | Supabase Storage | |

The client resolves its API base URL from an environment variable, so failover
between the primary and standby API is a redeploy of the client with no code
change.

**Report edit:** Add this table to section *3. Triển khai*.

---

## Summary of requirement coverage

Every functional and non-functional requirement in the specification is
implemented. The substitutions above change which component satisfies a
requirement, never whether it is satisfied. The one exception is the OAuth
registration path within UC01 (ADR-11), explicitly scoped out of this
delivery; Email/Password registration and session management — the rest of
UC01 — are fully implemented.

| Requirement | Satisfied by |
|---|---|
| FR01 Tenant isolation | `user_id` / `workspace_id` on every table, enforced in the data-access layer |
| FR02 Session management | JWT with expiry |
| FR03 Text extraction + OCR | Ingestion worker; OCR for image-only pages |
| FR04 Chunking | Two-level: structural split, then semantic boundary detection |
| FR05 RAG pipeline | pgvector embedding, storage, and similarity search (ADR-03) |
| FR06 Entity extraction to graph | Knowledge-extraction worker (ADR-04) |
| FR07 Hard context | Selected text injected into the prompt as a non-negotiable context block |
| FR08 Virtualized rendering | Windowed page renderer in the document viewer (ADR-09) |
| FR09 Streaming TTS | Streaming audio endpoint with browser fallback (ADR-08) |
| NFR01.1 Web application | Next.js client, Express API |
| NFR01.2 Server-side vectors and graph | All vectors and graph data in PostgreSQL; nothing persisted client-side |
| NFR02.1 Streamed AI responses | Server-Sent Events |
| NFR02.2 Queueing under load | PostgreSQL job queue with bounded workers (ADR-02) |
| NFR03.1 OCR error tolerance | Accepted and measured in the evaluation harness |
| NFR03.2 No multi-agent systems | Single-pass RAG and prompt engineering only |
| NFR04.1 IDOR prevention | Ownership checks in every data-access path, verified by security tests |
