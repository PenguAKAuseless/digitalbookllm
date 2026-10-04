/**
 * Builds each book's knowledge graph with the production extractor, as the
 * EXTRACT_ENTITIES job would after upload. Per-window LLM output is cached
 * in eval/results/kg-cache-<book>.json, so this can be stopped and resumed.
 *
 * Usage: BOOKS=hotpot-test,viquad-test npx ts-node eval/experiments/build-graphs.ts
 */
import './local-model';
import 'dotenv/config';
import { buildGraph, loadBenchmark, writeResult } from './shared';
import type { BenchmarkName } from './build-benchmark';

const BOOKS = (process.env.BOOKS || 'hotpot-test,viquad-test').split(',') as BenchmarkName[];

async function main() {
    const summary: Record<string, unknown> = {};
    for (const name of BOOKS) {
        const g = await buildGraph(loadBenchmark(name));
        summary[name] = { windows: g.windows, windowsOk: g.windowsOk, entities: g.entities.length, relations: g.relations.length, models: g.models };
        console.log(`${name}: ${g.windowsOk}/${g.windows} windows, ${g.entities.length} entities, ${g.relations.length} relations, models ${g.models.join(', ')}`);
    }
    writeResult('kg-summary.json', summary);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
