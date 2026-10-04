# RAG + knowledge-graph evaluation

Reproducible experiments for retrieval quality, hallucination, citation
support and the knowledge graph's contribution. Nothing here needs a running
server or database: the scripts call the production modules directly
(`Chunker`, `embeddingService`, `hybridRetrieve`, the KG extractor, the LLM
router and its prompt), with an in-memory `RetrievalStore` in place of
pgvector (exact cosine ranking).

## Datasets (public, peer-reviewed, human-annotated)

| Set | Source | Size | Questions | Used for |
|---|---|---|---|---|
| `viquad-test` | UIT-ViQuAD 2.0 validation (Vietnamese; VLSP 2021) | 65.6K chars | 306 answerable, 156 unanswerable | reported |
| `hotpot-test` | HotpotQA distractor validation (Yang et al., EMNLP 2018) | 104K chars | 17 multi-hop | reported |
| **KG-Series** (`eval/datasets/kg-series`, committed) | HotpotQA validation, bridge questions arranged into 3 volumes | 31K / 71K / 29K chars | 40 cross-volume | reported |
| `viquad-dev`, `hotpot-dev`, KG-Series dev | the same datasets' **train** splits | similar | similar | parameter choice only |

Every parameter was chosen on the dev sets; each test set was run once with
the chosen settings. See `eval/datasets/kg-series/README.md` for the series.

## Final retrieval design (`src/retrieval/hybridRetriever.ts`)

1. **Pass 1** — dense (all-MiniLM-L6-v2, pgvector) + BM25 over the book being
   read, fused by reciprocal rank (dense weight 0.5).
2. **Pass 2** — the same search over the *other* books in the workspace
   (books read earlier), its candidates **re-ranked by the knowledge graph**:
   passages naming an entity the graph links to the question move up. Takes
   up to 3 of the 5 result slots; never adds passages from the open book.
3. **Linking facts** — only the graph relations that join an entity of a
   passage from another book to the question or the open book go into the
   prompt; none when no such passage was retrieved.

## Results (top-k = 5; generator qwen2.5:7b via Ollama, temperature 0)

**Retrieval, single book** (R@5 = an annotated evidence span in the top 5):

| | ViQuAD (306 q) | HotpotQA (17 q) |
|---|---|---|
| before (semantic chunks only, dense) | 24.5% | 76.5% |
| + chunk merging (≥ 900 chars) | 36.3% | 100% |
| + BM25 (= production; the graph does not touch single-book ranking) | **82.7%** (R@1 41.2%) | **100%** (R@1 94.1%) |

**KG-Series, retrieval** (answer passage in the earlier volume, top 5):

| | Answer passage @5 | Full evidence chain @5 |
|---|---|---|
| open book only (before) | 0% | 0% |
| pass 2, plain question | 95.0% | 92.5% |
| pass 2, re-ranked by KG (production) | 95.0% | 92.5% |

**KG-Series, answers** (40 questions; paired exact McNemar test):

| | Correct | Abstained | Cited passages holding evidence |
|---|---|---|---|
| open book only | 5.0% | 67.5% | 65.8% |
| pass 2, no KG | 35.0% | 35.0% | 75.0% |
| pass 2 re-ranked by KG, no facts | 40.0% | 35.0% | 75.5% |
| pass 2 + all KG facts | 42.5% | 35.0% | 71.7% |
| **production: pass 2 + linking KG facts** | **57.5%** | **22.5%** | **82.1%** |

Production vs pass 2 without KG: +10 / −1 questions, p = 0.012; vs the same
retrieval without facts: +8 / −1, p = 0.039.

**Single book, answers** (17 HotpotQA; 15 answerable + 5 unanswerable ViQuAD):

| | HotpotQA correct | ViQuAD correct | ViQuAD answered an unanswerable question |
|---|---|---|---|
| no retrieval | 23.5% | 20.0% | 80% |
| before | 35.3% | 20.0% | 20% |
| production retrieval | 64.7% | 53.3% | 20% |

With one book the production prompt carries no graph facts, so it equals the
no-KG prompt; re-generating it gave 58.8% / 46.7%, which measures the local
model's run-to-run noise (GPU inference is not deterministic at temperature 0).

**KG-Chat** (`eval/datasets/kg-chat`, 40 OpenDialKG dialogues processed one
after another into a graph that starts from the KG-Series books; gold =
OpenDialKG's annotated triples that the dialogue verbalises):

| | LLM extractor (production) | Capitalised phrases + co-occurrence (no LLM) |
|---|---|---|
| Annotated entities found | 88.0% (154/175) | 82.9% |
| Annotated relations found | 47.4% (65/137) | 23.4% |
| Extracted entities named in the dialogue | 96.8% | 100% (by construction) |

| Graph growth | |
|---|---|
| Graph before → after the chats | 420 → 687 entities, 244 → 409 relations |
| New entities per dialogue | 6.7 |
| New entities with at least one relation | 74.2% |
| New entities attached to a node the graph already held | 10.1% (most dialogues are on topics new to the graph) |
| Annotated entities the graph already held, matched to the existing node | 7/7 |
| Case-variant duplicates: case-insensitive merge (production) vs exact-name merge (before) | 0 vs 1 |

## Notes and limits

- Graphs for the tuning and series sets were extracted by the local model
  (qwen2.5:7b); the single-book test graphs by Groq gpt-oss-120b. A few windows
  failed JSON parsing and were retried; one series window remains missing.
- qwen2.5:7b answered 40% of Vietnamese questions in Chinese despite the
  prompt; its Chinese refusals are counted as refusals. Production uses Groq.
- Sets are small (17-40 questions per test condition): differences under ~10
  points on them are within noise unless the paired test says otherwise.

## Scripts

| Script | LLM | What it does |
|---|---|---|
| `build-benchmark.ts`, `build-series.ts` | none | Download the datasets and build the books (series: `SPLIT=train` for dev) |
| `tune-chunker.ts`, `tune-retrieval.ts`, `tune-graph.ts` | none | Parameter choice on the dev books |
| `build-graphs.ts` | cached | Knowledge graphs with the production extractor |
| `retrieval-ablation.ts` | none | Single-book retrieval ablation |
| `series-ablation.ts` | cached | KG-Series retrieval (and `GENERATE=1` answers; `SERIES=dev` for dev) |
| `generation-ablation.ts` | cached | Single-book answers, hallucination, citation support |
| `build-chat-benchmark.ts`, `chat-kg-ablation.ts` | cached | KG-Chat: graph growth from conversations (OpenDialKG) |
| `tests/unit/ragKnowledgeGraphAblation.test.ts` | none | Real controller, KG on vs off, cross-volume question |

LLM outputs are cached under `eval/results/` (gitignored), so re-runs are free.
A local model is used with
`OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b-8k GROQ_API_KEY=`.
