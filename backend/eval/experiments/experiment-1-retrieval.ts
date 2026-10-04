/**
 * Experiment 1: retrieval within one book.
 *
 * Question: does the passage holding the answer reach the 5 passages given to
 * the model? Measured on the production retrieval with its parts switched on
 * one at a time.
 *
 * Data (test splits; gold = the datasets' annotated evidence spans)
 *   UIT-ViQuAD 2.0 validation: every answerable question of the test book (306)
 *   HotpotQA distractor validation: every question of the test book (17, multi-hop)
 *
 * Conditions (production chunker, all-MiniLM-L6-v2, top-k = 5)
 *   dense        vector search only
 *   hybrid       dense + BM25, fused by reciprocal rank
 *   production   hybrid, then the knowledge-graph second pass
 *
 * Metrics: R@k (a gold passage in the top k), MRR@5, all-support@k (every
 * evidence paragraph of a multi-hop question in the top k).
 *
 * Usage: npm run experiment:retrieval   (no LLM call; graphs come from the cache)
 * Output: eval/results/experiment-1-retrieval.json
 */
import './local-model';
import 'dotenv/config';
import { hybridRetrieve, RetrievalOptions } from '../../src/retrieval/hybridRetriever';
import {
    buildGraph, chunkBook, embed, embedChunks, goldGroups, loadBenchmark, MemoryStore, pct, PRODUCTION_CHUNKER,
    RetrievalMetrics, scoreRetrieval, writeResult,
} from './shared';
import type { BenchmarkName } from './build-benchmark';

const CONDITIONS: Array<{ name: string; options: Omit<RetrievalOptions, 'topK'> }> = [
    { name: 'dense', options: { lexical: false, graph: false } },
    { name: 'hybrid (dense + BM25)', options: { lexical: true, graph: false } },
    { name: 'production (hybrid + KG second pass)', options: { lexical: true, graph: true, embed } },
];

async function main() {
    const results: any = { config: { chunker: PRODUCTION_CHUNKER, topK: 5, embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2' } };

    for (const name of ['viquad-test', 'hotpot-test'] as BenchmarkName[]) {
        const bench = loadBenchmark(name);
        const graph = await buildGraph(bench); // from cache
        const questions = bench.questions.filter((q) => !q.isImpossible);
        const chunks = await chunkBook(bench.document, PRODUCTION_CHUNKER);
        const book = {
            store: new MemoryStore(chunks, await embedChunks(chunks), graph),
            golds: questions.map((q) => goldGroups(q, bench.document, chunks)),
            chunks: chunks.length,
            meanChars: Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length),
        };

        const rows: Array<{ condition: string; chunks: number; meanChars: number } & RetrievalMetrics> = [];
        const perQuestion: Record<string, Array<{ id: string; linked: string[]; top5: string[]; hit5: boolean }>> = {};
        for (const cond of CONDITIONS) {
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

    console.log(`\nFull results: ${writeResult('experiment-1-retrieval.json', results)}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
