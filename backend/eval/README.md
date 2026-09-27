# Evaluation Scripts

Standalone scripts that exercise a running instance over HTTP, separate from
the Jest suite in `tests/` (which runs in-process against the Express app).
Use these for post-deploy verification and for producing the metrics that
back the evaluation chapter of the report.

| Script | Maps to | What it measures |
|---|---|---|
| `security-probes.ts` | TC-SEC-01 family (NFR04.1) | IDOR resistance across workspaces/documents, auth rejection |
| `load-test.ts` | TC-PERF-01 (NFR02.2) | Concurrent-upload acceptance, baseline read throughput |
| `rag-eval.ts` | Benchmark section (NFR02.1, FR05) | Retrieval recall@k, generation keyword accuracy, TTFB |

## Running

Point `BASE_URL` at any live instance (local, staging, or production):

```bash
BASE_URL=http://localhost:3001 npm run test:security
BASE_URL=http://localhost:3001 CONCURRENT_UPLOADS=8 npm run test:load
BASE_URL=http://localhost:3001 npm run eval:rag
```

`rag-eval.ts` writes a full report to `eval/results/rag-eval-report.json`
(gitignored — regenerate on demand).

Retrieval metrics in `rag-eval.ts` do not require an LLM provider to be
configured: citations are streamed before generation begins, so recall@k can
be measured even when every provider in the router is unavailable.
Generation-accuracy metrics report `n/a` in that case instead of failing.
