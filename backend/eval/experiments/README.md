# Experiments: RAG + knowledge graph

Design, data, results and limits of the experiments are written up in one place:
**[docs/experiments.md](../../../docs/experiments.md)**. This page is how to run them.

Each experiment is one script that runs on its own and prints the tables used in the
write-up. They call the production modules directly (`Chunker`, `embeddingService`,
`hybridRetrieve`, the KG extractor, the LLM router and its prompt), with an in-memory
`RetrievalStore` in place of pgvector (exact cosine ranking): no server or database.

| Script | npm script | Question | LLM |
|---|---|---|---|
| `experiment-1-retrieval.ts` | `experiment:retrieval` | Does the evidence passage reach the top 5 of one book? | none |
| `experiment-2-answers.ts` | `experiment:answers` | Correct answers, hallucination on unanswerable questions, citation support | local |
| `experiment-3-kg-series.ts` | `experiment:kg-series` | Does the graph link a question to the book read earlier, and answer it? | local |
| `experiment-4-kg-chat.ts` | `experiment:kg-chat` | Does the graph learn entities and relations from chat? | local |

## Running

```bash
cd backend
ollama pull qwen2.5:7b        # once; experiments never call a paid API (local-model.ts)
npx ts-node eval/experiments/build-benchmark.ts   # once: download the datasets, build the test/dev books
npm run experiment:all        # or one at a time, e.g. npm run experiment:answers
```

Results go to `eval/results/experiment-*.json` (gitignored). Model outputs are cached
by the exact prompt sent (`answers.ts`) and graph windows by their text (`shared.ts`),
so a re-run only generates what changed.

## Files

| File | Role |
|---|---|
| `local-model.ts` | Forces the local model (Ollama, qwen2.5:7b) and blanks every hosted provider key; imported first by each experiment |
| `shared.ts` | Benchmark loading, gold-passage matching, in-memory store, graph building, retrieval metrics |
| `answers.ts` | Answer generation (cached by prompt) and deterministic scoring |
| `build-benchmark.ts`, `build-series.ts`, `build-chat-benchmark.ts` | Build the books and question sets from the public datasets |
| `build-graphs.ts` | Knowledge graphs of the test books through the production extractor |
| `tune-chunker.ts`, `tune-retrieval.ts`, `tune-graph.ts` | Parameter choice on the dev splits only |
| `data/` | Downloaded datasets and built books (gitignored) |
