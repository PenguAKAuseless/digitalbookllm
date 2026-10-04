/**
 * Chooses how many graph-guided second-pass passages to add, on the DEV books
 * only (single-book setting: does the hop cost in-book recall?). The dev
 * graphs are built with the production extractor (served by a local Ollama
 * model, so tuning spends no hosted quota).
 *
 * Usage: OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b-8k GROQ_API_KEY= \
 *        npx ts-node eval/experiments/tune-graph.ts
 */
import './local-model';
import 'dotenv/config';
import { hybridRetrieve, RetrievalOptions } from '../../src/retrieval/hybridRetriever';
import { buildGraph, chunkBook, embed, embedChunks, goldGroups, loadBenchmark, MemoryStore, pct, PRODUCTION_CHUNKER, scoreRetrieval, writeResult } from './shared';

const VARIANTS: Array<{ name: string; options: Omit<RetrievalOptions, 'topK'> }> = [
    { name: 'no graph (dense+BM25)', options: { graph: false } },
    { name: 'second pass also in-book (re-rank, 3 slots)', options: { graph: true, hopScope: 'any', embed } },
    { name: 'second pass other books only = production (re-rank, 3 slots)', options: { graph: true, hopScope: 'other-documents', embed } },
];

async function main() {
    const rows: any[] = [];
    for (const name of ['viquad-dev', 'hotpot-dev'] as const) {
        const bench = loadBenchmark(name);
        const graph = await buildGraph(bench);
        console.log(`${name}: graph ${graph.entities.length} entities, ${graph.relations.length} relations (${graph.windowsOk}/${graph.windows} windows)`);
        const questions = bench.questions.filter((q) => !q.isImpossible);
        const chunks = await chunkBook(bench.document, PRODUCTION_CHUNKER);
        const store = new MemoryStore(chunks, await embedChunks(chunks), graph);
        const golds = questions.map((q) => goldGroups(q, bench.document, chunks));
        for (const v of VARIANTS) {
            const rankings: string[][] = [];
            for (const q of questions) {
                // top-k 5 as in production: second-pass passages take the last of these slots.
                const r = await hybridRetrieve(store, q.question, await embed(q.question), { topK: 5, ...v.options });
                rankings.push(r.chunks.map((c) => c.id));
            }
            rows.push({ bench: name, variant: v.name, ...scoreRetrieval(rankings, golds) });
        }
    }
    console.log('\n| Variant | ViQuAD-dev R@1 | ViQuAD-dev R@5 | HotpotQA-dev R@1 | HotpotQA-dev R@5 | HotpotQA-dev all-support@3 | HotpotQA-dev all-support@5 |');
    console.log('|---|---|---|---|---|---|---|');
    for (const v of VARIANTS) {
        const a = rows.find((r) => r.bench === 'viquad-dev' && r.variant === v.name);
        const b = rows.find((r) => r.bench === 'hotpot-dev' && r.variant === v.name);
        console.log(`| ${v.name} | ${pct(a.recallAt1)} | ${pct(a.recallAt5)} | ${pct(b.recallAt1)} | ${pct(b.recallAt5)} | ${pct(b.allSupportAt3)} | ${pct(b.allSupportAt5)} |`);
    }
    writeResult('tune-graph.json', rows);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
