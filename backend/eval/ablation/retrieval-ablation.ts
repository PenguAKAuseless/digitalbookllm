/**
 * Retrieval ablation on the TEST books: the production hybridRetrieve() with
 * components switched on one at a time, all with the production embedding
 * model (all-MiniLM-L6-v2) and top-k = 5.
 *
 *   baseline     chunker without short-piece merging, dense only (the system before this change)
 *   +chunker     current chunker, dense only
 *   +bm25        current chunker, dense + BM25
 *   +kg          current chunker, dense + BM25, then the graph-guided second pass   <- production
 *
 * Also re-scores the original 4-question golden set (eval/golden-set.json).
 * Needs the graphs from build-graphs.ts (cached; no LLM call here).
 *
 * Usage: npx ts-node eval/ablation/retrieval-ablation.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { hybridRetrieve, RetrievalOptions } from '../../src/retrieval/hybridRetriever';
import {
    BASELINE_CHUNKER, buildGraph, chunkBook, ChunkerConfig, embed, embedChunks, goldGroups, loadBenchmark, MemoryStore, pct,
    RetrievalMetrics, scoreRetrieval, writeResult,
} from './shared';
import type { BenchmarkName } from './build-benchmark';

/** Production chunker defaults (src/chunking/chunker.ts). */
export const CURRENT_CHUNKER: ChunkerConfig = {
    size: parseInt(process.env.CHUNK_SIZE_CHARS || '1800'),
    overlap: parseInt(process.env.CHUNK_OVERLAP_CHARS || '200'),
    threshold: parseFloat(process.env.SEMANTIC_CHUNK_THRESHOLD || '0.45'),
    minChars: parseInt(process.env.CHUNK_MIN_CHARS || '900'),
};

const CONDITIONS: Array<{ name: string; chunker: 'baseline' | 'current'; options: Omit<RetrievalOptions, 'topK'> }> = [
    { name: 'baseline (dense, old chunker)', chunker: 'baseline', options: { lexical: false, graph: false, weights: { dense: 1, lexical: 1 } } },
    { name: '+chunker (dense)', chunker: 'current', options: { lexical: false, graph: false } },
    { name: '+bm25 (dense+BM25)', chunker: 'current', options: { lexical: true, graph: false } },
    { name: '+kg two-pass = production', chunker: 'current', options: { lexical: true, graph: true, embed } },
];

async function goldenSet() {
    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden-set.json'), 'utf-8'));
    const out: Record<string, unknown> = { questions: golden.cases.length, corpusChars: golden.corpus.length, k: 5 };
    for (const [label, cfg] of [['baseline', BASELINE_CHUNKER], ['current', CURRENT_CHUNKER]] as const) {
        const chunks = await chunkBook(golden.corpus, cfg);
        const store = new MemoryStore(chunks, await embedChunks(chunks), { entities: [], relations: [] });
        const options = label === 'baseline' ? { lexical: false, graph: false } : { lexical: true, graph: false };
        let any5 = 0, any1 = 0, all1 = 0;
        for (const c of golden.cases) {
            const r = await hybridRetrieve(store, c.question, await embed(c.question), { topK: 5, ...options });
            const texts = r.chunks.map((x) => x.text);
            if (c.expectedKeywords.some((k: string) => texts.join(' ').includes(k))) any5++;
            if (c.expectedKeywords.some((k: string) => texts[0]?.includes(k))) any1++;
            if (c.expectedKeywords.every((k: string) => texts[0]?.includes(k))) all1++;
        }
        const n = golden.cases.length;
        out[label] = { chunks: chunks.length, recallAt5_anyKeyword: any5 / n, recallAt1_anyKeyword: any1 / n, recallAt1_allKeywords: all1 / n };
    }
    return out;
}

async function main() {
    const results: any = { config: { baselineChunker: BASELINE_CHUNKER, currentChunker: CURRENT_CHUNKER, topK: 5, embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2' } };
    results.goldenSet = await goldenSet();
    console.log('Original golden set:', JSON.stringify(results.goldenSet));

    for (const name of ['viquad-test', 'hotpot-test'] as BenchmarkName[]) {
        const bench = loadBenchmark(name);
        const graph = await buildGraph(bench); // from cache
        const questions = bench.questions.filter((q) => !q.isImpossible);
        const books: Record<string, { store: MemoryStore; golds: string[][][]; chunks: number; meanChars: number }> = {};
        for (const [label, cfg] of [['baseline', BASELINE_CHUNKER], ['current', CURRENT_CHUNKER]] as const) {
            const chunks = await chunkBook(bench.document, cfg);
            books[label] = {
                store: new MemoryStore(chunks, await embedChunks(chunks), graph),
                golds: questions.map((q) => goldGroups(q, bench.document, chunks)),
                chunks: chunks.length,
                meanChars: Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length),
            };
        }

        const rows: Array<{ condition: string; chunks: number; meanChars: number } & RetrievalMetrics> = [];
        const perQuestion: Record<string, Array<{ id: string; linked: string[]; top5: string[]; hit5: boolean }>> = {};
        for (const cond of CONDITIONS) {
            const book = books[cond.chunker];
            const rankings: string[][] = [];
            perQuestion[cond.name] = [];
            for (const q of questions) {
                const r = await hybridRetrieve(book.store, q.question, await embed(q.question), { topK: 5, ...cond.options });
                const ids = r.chunks.map((c) => c.id);
                rankings.push(ids);
                const gold = new Set(book.golds[rankings.length - 1].flat());
                perQuestion[cond.name].push({ id: q.id, linked: r.linkedEntities, top5: ids.slice(0, 5), hit5: ids.slice(0, 5).some((id) => gold.has(id)) });
            }
            rows.push({ condition: cond.name, chunks: book.chunks, meanChars: book.meanChars, ...scoreRetrieval(rankings, book.golds) });
        }

        const linkedShare = perQuestion[CONDITIONS[CONDITIONS.length - 1].name].filter((p) => p.linked.length > 0).length / questions.length;
        console.log(`\n### ${bench.source}: ${questions.length} answerable questions, ${bench.document.length} chars`);
        console.log(`Graph: ${graph.entities.length} entities, ${graph.relations.length} relations (${graph.windowsOk}/${graph.windows} windows); questions linked to >=1 entity: ${pct(linkedShare)}`);
        console.log('\n| Condition | Chunks (mean chars) | R@1 | R@3 | **R@5** | MRR@5 | All-support@3 | All-support@5 |');
        console.log('|---|---|---|---|---|---|---|---|');
        for (const r of rows) {
            console.log(`| ${r.condition} | ${r.chunks} (${r.meanChars}) | ${pct(r.recallAt1)} | ${pct(r.recallAt3)} | **${pct(r.recallAt5)}** | ${r.mrrAt10.toFixed(3)} | ${pct(r.allSupportAt3)} | ${pct(r.allSupportAt5)} |`);
        }
        results[name] = { source: bench.source, questions: questions.length, graph: { entities: graph.entities.length, relations: graph.relations.length, windows: graph.windows, windowsOk: graph.windowsOk, models: graph.models, linkedShare }, rows, perQuestion };
    }

    console.log(`\nFull results: ${writeResult('ablation-retrieval.json', results)}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
