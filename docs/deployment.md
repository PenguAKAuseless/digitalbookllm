# Deployment Guide

Concrete steps to take the system from a clean checkout to a public URL, on
the free-tier topology chosen in
[architecture-decisions.md](./architecture-decisions.md) (ADR-12). Each
provider's console can rename fields over time — the values here are what to
enter, not clickpaths.

## Local full-stack testing (Docker Compose)

Before touching any cloud provider, the whole application — Postgres,
backend+worker, frontend — runs locally with one command, from the
repository root:

```bash
cp .env.example .env                    # DB credentials, browser-facing API URL
cp backend/.env.example backend/.env    # LLM provider keys, JWT secret, etc.
docker compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:3001
- Postgres: `localhost:${DB_PORT}` (default `5432`; change it in `.env` if
  something else on the host already listens there)

`backend/.env` needs at least one LLM provider key for chat to work (see
§2 below); everything else — upload, reading, highlights, the knowledge
graph — works with no provider configured. This compose file
(`docker-compose.yml` at the repo root) is for local verification only; the
cloud deployment in the sections below runs each service on its own
platform instead, per ADR-12.

`docker compose down -v` removes the Postgres volume for a clean slate.

## Topology

```
Vercel (Next.js client)
   │  NEXT_PUBLIC_API_URL
   ▼
Render (primary API + worker, Docker) ──── optional standby ──── Hugging Face Spaces
        │
        ▼
Supabase (Postgres + pgvector, Storage)
```

The client resolves its API base URL from `NEXT_PUBLIC_API_URL` at build
time. Failover between the primary and standby API is a Vercel env var change
and redeploy — no code change.

## 1. Provision Supabase

1. Create a project at supabase.com (free tier).
2. **Database → Extensions**: enable `vector`.
3. **SQL Editor**: paste and run `backend/src/db/schema.sql`.
4. **Storage**: create a bucket named `documents` (private).
5. **Project Settings → API**: copy the Project URL and the `service_role`
   key (not the `anon` key — the backend needs write access to Storage).
6. **Project Settings → Database**: copy the connection string
   (use the pooled "Transaction" connection string for `DATABASE_URL`).

Resulting values for the backend `.env`:

```
DATABASE_URL=<Supabase pooled connection string>
SUPABASE_URL=<Project URL>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_STORAGE_BUCKET=documents
```

## 2. Configure at least one LLM provider

The router (ADR-07) works with zero, one, or many providers configured — but
zero means every chat request returns a clear "no provider" error. Pick at
least one free-trial provider for tier 1, and fill in tier 2/3 for
redundancy:

| Env var | Where to get it |
|---|---|
| `CEREBRAS_API_KEY` | cloud.cerebras.ai — free tier, no card |
| `SAMBANOVA_API_KEY` | cloud.sambanova.ai — free tier, no card |
| `GEMINI_API_KEY` | aistudio.google.com/apikey — free tier |
| `GROQ_API_KEY` | console.groq.com/keys — free tier |

Any subset works; unset ones are skipped by `isConfigured()` in the router.

## 3. Deploy the backend — Render (primary)

1. Create a **Web Service** and connect the repository.
2. Set the root directory to `backend/` and the environment to **Docker**.
3. Add the variables from `backend/.env.example`, plus the Supabase and
   production values from §1. Do not set a fixed port unless Render requires
   it — the application reads Render's `PORT` value automatically.
4. Set `FRONTEND_URL` to the Vercel origin after the frontend is created.
5. Copy the generated Render URL, for example
   `https://digitalbookllm-api.onrender.com`.

Render's free service may spin down after inactivity. A scheduled request to
`/health` can reduce cold starts, but does not guarantee that the service stays
running or override the provider's free-tier policy.

## 4. Deploy the backend — Hugging Face Spaces (optional standby)

1. Create a new Space using the **Docker** SDK.
2. Deploy the `backend/` directory as the Space root.
3. Add the same backend secrets as the Render service.
4. Configure the Space's exposed application port according to its Space
   settings; the container supports a runtime `PORT` value.
5. Use the Space URL only as a manual failover target.

## 5. Deploy the frontend — Vercel

1. Import the repository, set the project root to `frontend/`.
2. Framework preset: Next.js (auto-detected).
3. Environment variable:
   ```
   NEXT_PUBLIC_API_URL=https://<your-render-url>/api
   ```
4. Deploy. Vercel's free tier serves the app on a `*.vercel.app` domain with
   automatic HTTPS and a global CDN.

To fail over to the HF standby API, change `NEXT_PUBLIC_API_URL` to the Space
URL and redeploy.

## 6. Post-deploy verification

```bash
BASE_URL=https://<api-url> npm run test:security --prefix backend
BASE_URL=https://<api-url> CONCURRENT_UPLOADS=6 npm run test:load --prefix backend
BASE_URL=https://<api-url> npm run eval:rag --prefix backend
```

All three should complete with no failing probes; see
[test-scenarios.md](./test-scenarios.md) §8 for the manual smoke-test log
from this delivery's own verification pass.

## 7. Running the tests locally

Integration tests need a disposable Postgres with the schema applied:

```bash
cd backend
docker compose up -d postgres
npm run migrate
npm test
```

Or point `DATABASE_URL` / `DB_HOST` at any reachable Postgres with the
`vector` extension available; the integration suite self-skips when neither
is set (`describeIfDb` in `tests/helpers/testApp.ts`).

## 8. Environment variable reference

See `backend/.env.example` for the complete, commented list — provider keys,
chunking parameters, rate limits, and the TTS provider hook (ADR-08). Nothing
outside that file is required to deploy the backend.
