/**
 * Chooses the chunker's minimum piece size on the DEV books only (train
 * splits), never on the reported test books. Retrieval is the production
 * hybrid (dense + BM25) without the graph, so no LLM call is needed.
 *
 * Usage: npx ts-node eval/experiments/tune-chunker.ts
 */
import 'dotenv/config';
import { hybridRetrieve } from '../../src/retrieval/hybridRetriever';
import { chunkBook, ChunkerConfig, embed, embedChunks, goldGroups, loadBenchmark, MemoryStore, pct, scoreRetrieval, writeResult } from './shared';

const GRID: ChunkerConfig[] = [1800, 1200].flatMap((size) =>
    [0, 300, 600, 900, 1200].map((minChars) => ({ size, overlap: 200, threshold: 0.45, minChars }))
);

async function main() {
    const rows: any[] = [];
    for (const name of ['viquad-dev', 'hotpot-dev'] as const) {
        const bench = loadBenchmark(name);
        const questions = bench.questions.filter((q) => !q.isImpossible);
        const queryVecs = new Map<string, number[]>();
        for (const q of questions) queryVecs.set(q.id, await embed(q.question));

        for (const cfg of GRID) {
            const chunks = await chunkBook(bench.document, cfg);
            const store = new MemoryStore(chunks, await embedChunks(chunks), { entities: [], relations: [] });
            const rankings: string[][] = [];
            const golds: string[][][] = [];
            for (const q of questions) {
                const r = await hybridRetrieve(store, q.question, queryVecs.get(q.id)!, { topK: 10, graph: false });
                rankings.push(r.chunks.map((c) => c.id));
                golds.push(goldGroups(q, bench.document, chunks));
            }
            const m = scoreRetrieval(rankings, golds);
            const meanChars = Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length);
            rows.push({ bench: name, ...cfg, chunks: chunks.length, meanChars, ...m });
            console.log(`${name} size=${cfg.size} min=${cfg.minChars}: ${chunks.length} chunks (${meanChars} chars) R@5=${pct(m.recallAt5)} allSupport@5=${pct(m.allSupportAt5)} unreachable=${m.unreachable}`);
        }
    }

    console.log('\n| Size | Min piece | ViQuAD-dev R@5 | HotpotQA-dev R@5 | HotpotQA-dev all-support@5 | Mean |');
    console.log('|---|---|---|---|---|---|');
    for (const cfg of GRID) {
        const v = rows.find((r) => r.bench === 'viquad-dev' && r.size === cfg.size && r.minChars === cfg.minChars);
        const h = rows.find((r) => r.bench === 'hotpot-dev' && r.size === cfg.size && r.minChars === cfg.minChars);
        console.log(`| ${cfg.size} | ${cfg.minChars} | ${pct(v.recallAt5)} | ${pct(h.recallAt5)} | ${pct(h.allSupportAt5)} | ${pct((v.recallAt5 + h.recallAt5) / 2)} |`);
    }
    writeResult('tune-chunker.json', rows);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
