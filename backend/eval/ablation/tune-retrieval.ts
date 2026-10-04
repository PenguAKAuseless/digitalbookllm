/**
 * Second tuning round, on the DEV books only: the semantic split threshold
 * (with the minimum piece size chosen by tune-chunker.ts) and the RRF weight
 * of the dense vs lexical signal. No LLM call; the graph is not used here.
 *
 * Usage: npx ts-node eval/ablation/tune-retrieval.ts
 */
import 'dotenv/config';
import { hybridRetrieve } from '../../src/retrieval/hybridRetriever';
import { chunkBook, embed, embedChunks, goldGroups, loadBenchmark, MemoryStore, pct, scoreRetrieval, writeResult } from './shared';

const THRESHOLDS = [0.45, 0.6, 0.75];
const DENSE_WEIGHTS = [1, 0.75, 0.5];

async function main() {
    const rows: any[] = [];
    for (const name of ['viquad-dev', 'hotpot-dev'] as const) {
        const bench = loadBenchmark(name);
        const questions = bench.questions.filter((q) => !q.isImpossible);
        for (const threshold of THRESHOLDS) {
            const chunks = await chunkBook(bench.document, { size: 1800, overlap: 200, threshold, minChars: 900 });
            const store = new MemoryStore(chunks, await embedChunks(chunks), { entities: [], relations: [] });
            const golds = questions.map((q) => goldGroups(q, bench.document, chunks));
            for (const dense of DENSE_WEIGHTS) {
                const rankings: string[][] = [];
                for (const q of questions) {
                    const r = await hybridRetrieve(store, q.question, await embed(q.question), {
                        topK: 10, graph: false, weights: { dense, lexical: 1 },
                    });
                    rankings.push(r.chunks.map((c) => c.id));
                }
                const m = scoreRetrieval(rankings, golds);
                rows.push({ bench: name, threshold, dense, chunks: chunks.length, ...m });
                console.log(`${name} threshold=${threshold} dense=${dense}: R@5=${pct(m.recallAt5)} all@5=${pct(m.allSupportAt5)}`);
            }
        }
    }
    console.log('\n| Threshold | Dense weight | ViQuAD-dev R@5 | HotpotQA-dev R@5 | HotpotQA-dev all-support@5 | Mean R@5 |');
    console.log('|---|---|---|---|---|---|');
    for (const threshold of THRESHOLDS) {
        for (const dense of DENSE_WEIGHTS) {
            const v = rows.find((r) => r.bench === 'viquad-dev' && r.threshold === threshold && r.dense === dense);
            const h = rows.find((r) => r.bench === 'hotpot-dev' && r.threshold === threshold && r.dense === dense);
            console.log(`| ${threshold} | ${dense} | ${pct(v.recallAt5)} | ${pct(h.recallAt5)} | ${pct(h.allSupportAt5)} | ${pct((v.recallAt5 + h.recallAt5) / 2)} |`);
        }
    }
    writeResult('tune-retrieval.json', rows);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
