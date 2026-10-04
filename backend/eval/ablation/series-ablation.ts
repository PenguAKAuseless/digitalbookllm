/**
 * KG-Series evaluation (eval/datasets/kg-series): does the knowledge graph
 * built from volumes already read bring the right passage of an earlier
 * volume into the answer to a question asked while reading a later one?
 *
 * The reading order is simulated: a question asked in volume v sees a
 * workspace of volumes 1..v and a graph extracted from those volumes only
 * (each volume through the production extractor, entities merged by name
 * across volumes as the worker does per user).
 *
 * Conditions (top-k = 5, production embedding model)
 *   baseline           the system before this change: old chunker, dense, document scope
 *   doc hybrid         current chunker, dense + BM25, document scope, no graph
 *   workspace hybrid   current chunker, dense + BM25 over every volume read so far, no graph
 *   2nd pass, plain    document scope, then a second pass over earlier volumes with the plain question
 *   2nd pass, KG       the same second pass, guided or re-ranked by the knowledge graph (production: re-ranked)
 *
 * Metrics
 *   answer@5   the answer paragraph's supporting sentence (in the earlier volume) is retrieved
 *   bridge@5   the bridge paragraph's supporting sentence (in the volume being read) is retrieved
 *   both@5     both — the full evidence chain
 *
 * Usage (graph extraction is cached per volume; this uses a local model):
 *   OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b-8k GROQ_API_KEY= \
 *   npx ts-node eval/ablation/series-ablation.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEntity, GraphRelation } from '../../src/retrieval/graphSignals';
import { CorpusChunk, hybridRetrieve, RetrievalOptions, RetrievalStore, ScopeCorpus } from '../../src/retrieval/hybridRetriever';
import type { SeriesQuestion, SeriesSpan } from './build-series';
import { CURRENT_CHUNKER } from './retrieval-ablation';
import { BASELINE_CHUNKER, buildGraph, chunkBook, chunksContainingSpan, ChunkerConfig, embed, embedChunks, normalize, pct, writeResult } from './shared';
import * as shared from './shared';
import { llmRouter } from '../../src/llm/router';
import { citedPassageIndices } from '../../src/controllers/ragController';
import { abstained, cached, containsAnswer, GENERATOR, tokenF1 } from './generation-ablation';

/** SERIES=dev evaluates the train-split copy used for choosing parameters; the default is the committed test set. */
const DEV = process.env.SERIES === 'dev';
const DATASET = DEV ? path.join(__dirname, 'data', 'kg-series-dev') : path.join(__dirname, '..', 'datasets', 'kg-series');
const CACHE_PREFIX = DEV ? 'series-dev-vol' : 'series-vol';
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

interface VolumeIndex {
    number: number;
    text: string;
    chunks: CorpusChunk[];
    vectors: Map<string, number[]>;
}

/** Retrieval store for "reading volume v": document scope = volume v; the graph reaches volumes 1..v. */
class SeriesStore implements RetrievalStore {
    private scope: ScopeCorpus;
    private workspace: ScopeCorpus;

    constructor(
        private volumes: VolumeIndex[],
        private v: number,
        private kg: { entities: GraphEntity[]; relations: Array<GraphRelation & { volume: number }> },
        private searchWholeWorkspace = false
    ) {
        const read = volumes.filter((x) => x.number <= v);
        this.workspace = new ScopeCorpus(read.flatMap((x) => x.chunks));
        this.scope = searchWholeWorkspace ? this.workspace : new ScopeCorpus(volumes[v - 1].chunks);
    }

    private vector(id: string): number[] {
        for (const vol of this.volumes) if (vol.vectors.has(id)) return vol.vectors.get(id)!;
        throw new Error(`no vector for ${id}`);
    }

    async denseSearch(q: number[], limit: number) {
        return this.scope.chunks
            .map((c) => ({ id: c.id, similarity: dot(q, this.vector(c.id)) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    async similarities(ids: string[], q: number[]) {
        return new Map(ids.map((id) => [id, dot(q, this.vector(id))]));
    }

    async corpus() {
        return this.scope;
    }

    async hopCorpus() {
        return this.workspace;
    }

    async hopDenseSearch(q: number[], limit: number) {
        return this.workspace.chunks
            .map((c) => ({ id: c.id, similarity: dot(q, this.vector(c.id)) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    async graph() {
        return { entities: this.kg.entities, relations: this.kg.relations.filter((r) => r.volume <= this.v) };
    }
}

async function indexVolumes(cfg: ChunkerConfig): Promise<VolumeIndex[]> {
    const out: VolumeIndex[] = [];
    for (const n of [1, 2, 3]) {
        const text = fs.readFileSync(path.join(DATASET, `volume-${n}.txt`), 'utf-8');
        const chunks = (await chunkBook(text, cfg)).map((c) => ({ ...c, id: `v${n}:${c.id}`, document_id: `vol${n}`, document_name: `Volume ${n}` }));
        out.push({ number: n, text, chunks, vectors: await embedChunks(chunks) });
    }
    return out;
}

/** Graph of the whole series, built volume by volume and merged by entity name, each relation tagged with its volume. */
async function seriesGraph() {
    const byKey = new Map<string, GraphEntity>();
    const relations: Array<GraphRelation & { volume: number }> = [];
    const stats: Array<{ volume: number; windows: number; ok: number; entities: number; relations: number; models: string[] }> = [];
    for (const n of [1, 2, 3]) {
        const document = fs.readFileSync(path.join(DATASET, `volume-${n}.txt`), 'utf-8');
        const g = await buildGraph({ name: `${CACHE_PREFIX}${n}`, document } as any);
        const local = new Map(g.entities.map((e) => [e.id, e]));
        const resolve = (id: string) => {
            const e = local.get(id)!;
            const key = e.name.toLowerCase();
            if (!byKey.has(key)) byKey.set(key, { id: `E${byKey.size}`, name: e.name, type: e.type });
            return byKey.get(key)!.id;
        };
        g.entities.forEach((e) => resolve(e.id));
        for (const r of g.relations) relations.push({ sourceId: resolve(r.sourceId), targetId: resolve(r.targetId), type: r.type, volume: n });
        stats.push({ volume: n, windows: g.windows, ok: g.windowsOk, entities: g.entities.length, relations: g.relations.length, models: g.models });
    }
    return { entities: [...byKey.values()], relations, stats };
}

function goldIds(spans: SeriesSpan[], volumes: VolumeIndex[]): Set<string> {
    const ids = new Set<string>();
    for (const s of spans) {
        const vol = volumes[s.volume - 1];
        const norm = vol.chunks.map((c) => normalize(c.text));
        for (const i of chunksContainingSpan(s, vol.text, norm)) ids.add(vol.chunks[i].id);
    }
    return ids;
}

/**
 * Answer generation on the series (GENERATE=1), with the production prompt
 * (llmRouter.buildMessages) at temperature 0. Scored against HotpotQA's
 * reference answers; a citation counts as supported when the cited passage
 * contains an annotated supporting sentence.
 */
async function generate(questions: SeriesQuestion[], kg: Awaited<ReturnType<typeof seriesGraph>>, volumes: VolumeIndex[]) {
    const conditions: Array<{ name: string; options: Omit<RetrievalOptions, 'topK'>; facts: boolean }> = [
        { name: 'doc only (no 2nd pass, no KG)', options: { graph: false }, facts: false },
        { name: '2nd pass, plain (no KG)', options: { graph: false, secondPass: 'plain' }, facts: false },
        { name: '2nd pass re-ranked by KG, no facts', options: { graph: true, embed, facts: 'none' }, facts: false },
        { name: '2nd pass re-ranked by KG + all KG facts', options: { graph: true, embed, facts: 'all' }, facts: true },
        { name: 'production: 2nd pass re-ranked by KG + linking facts', options: { graph: true, embed, facts: 'linked' }, facts: true },
    ];
    const rows = [];
    const items: unknown[] = [];
    for (const cond of conditions) {
        let correct = 0, f1 = 0, abst = 0, citedEarlier = 0, citedTotal = 0, citedSupported = 0;
        for (const [n, q] of questions.entries()) {
            const store = new SeriesStore(volumes, q.askedIn, kg, false);
            const r = await hybridRetrieve(store, q.question, await embed(q.question), { topK: 5, ...cond.options });
            const gold = new Set([...goldIds(q.support.answer, volumes), ...goldIds(q.support.bridge, volumes)]);
            const messages = llmRouter.buildMessages(q.question, undefined, r.chunks, cond.facts ? r.graphFacts : []);
            const gen = await cached(`series${DEV ? '-dev' : ''}|${cond.name}|${q.id}|${GENERATOR}`, async () => {
                const out = await llmRouter.generate(messages, { temperature: 0 });
                return { answer: out.text, model: out.provider === 'Ollama' ? `ollama/${process.env.OLLAMA_MODEL}` : shared.lastGroqModel };
            });
            const cited = citedPassageIndices(gen.answer, r.chunks.length).map((i) => r.chunks[i - 1]);
            const hit = containsAnswer(gen.answer, [q.answer], 'en');
            correct += Number(hit);
            f1 += tokenF1(gen.answer, q.answer, 'en');
            abst += Number(abstained(gen.answer));
            citedTotal += cited.length;
            citedEarlier += cited.filter((c) => c.document_id !== `vol${q.askedIn}`).length;
            citedSupported += cited.filter((c) => gold.has(c.id)).length;
            items.push({ condition: cond.name, id: q.id, question: q.question, reference: q.answer, answer: gen.answer, model: gen.model, facts: cond.facts ? r.graphFacts : [], correct: hit });
            console.log(`[series gen] ${cond.name} ${n + 1}/${questions.length}`);
        }
        const N = questions.length;
        rows.push({
            condition: cond.name,
            accuracy: correct / N,
            f1: f1 / N,
            abstained: abst / N,
            citedPassagesPerAnswer: citedTotal / N,
            citedFromEarlierVolume: citedTotal ? citedEarlier / citedTotal : null,
            citedPassagesWithEvidence: citedTotal ? citedSupported / citedTotal : null,
        });
    }
    console.log('\n| Condition | Answer accuracy | F1 | Abstained | Cited passages / answer | Cited from earlier volume | Cited passages holding annotated evidence |');
    console.log('|---|---|---|---|---|---|---|');
    for (const r of rows) {
        console.log(`| ${r.condition} | ${pct(r.accuracy)} | ${r.f1.toFixed(3)} | ${pct(r.abstained)} | ${r.citedPassagesPerAnswer.toFixed(2)} | ${pct(r.citedFromEarlierVolume)} | ${pct(r.citedPassagesWithEvidence)} |`);
    }
    console.log(`Full results: ${writeResult(DEV ? 'generation-series-dev.json' : 'generation-series.json', { rows, items })}`);
}

async function main() {
    const questions: SeriesQuestion[] = JSON.parse(fs.readFileSync(path.join(DATASET, 'questions.json'), 'utf-8'));
    const kg = await seriesGraph();
    for (const s of kg.stats) console.log(`graph volume ${s.volume}: ${s.ok}/${s.windows} windows, ${s.entities} entities, ${s.relations} relations (${s.models.join(', ')})`);
    console.log(`merged graph: ${kg.entities.length} entities, ${kg.relations.length} relations`);
    if (process.env.KG_ONLY) return;

    if (process.env.GENERATE) {
        shared.installGroqRateLimiter();
        return generate(questions, kg, await indexVolumes(CURRENT_CHUNKER));
    }

    const indexes = { baseline: await indexVolumes(BASELINE_CHUNKER), current: await indexVolumes(CURRENT_CHUNKER) };
    const conditions: Array<{ name: string; chunker: 'baseline' | 'current'; workspace: boolean; options: Omit<RetrievalOptions, 'topK'> }> = [
        { name: 'baseline (old chunker, dense, document scope)', chunker: 'baseline', workspace: false, options: { lexical: false, graph: false } },
        { name: 'doc hybrid (dense+BM25, no KG)', chunker: 'current', workspace: false, options: { graph: false } },
        { name: 'workspace hybrid (all volumes read, no KG)', chunker: 'current', workspace: true, options: { graph: false } },
        { name: '2nd pass over earlier books, plain question (no KG)', chunker: 'current', workspace: false, options: { graph: false, secondPass: 'plain' } },
        { name: '2nd pass, KG-guided searches + plain fill', chunker: 'current', workspace: false, options: { graph: true, secondPass: 'graph+plain', embed } },
        { name: '2nd pass, plain re-ranked by KG = production', chunker: 'current', workspace: false, options: { graph: true, embed } },
        // Variants compared on the dev copy only, to choose the production settings.
        ...(DEV
            ? [1, 2].flatMap((hopSlots) =>
                  (['plain', 'graph+plain', 'rerank'] as const).map((secondPass) => ({
                      name: `${secondPass}, ${hopSlots} slot(s)`,
                      chunker: 'current' as const,
                      workspace: false,
                      options: { graph: secondPass !== 'plain', secondPass, hopSlots, embed },
                  }))
              )
            : []),
    ];

    const rows = [];
    const perQuestion: Record<string, unknown[]> = {};
    for (const cond of conditions) {
        const volumes = indexes[cond.chunker];
        let answerHits = 0, bridgeHits = 0, bothHits = 0;
        perQuestion[cond.name] = [];
        for (const q of questions) {
            const store = new SeriesStore(volumes, q.askedIn, kg, cond.workspace);
            const r = await hybridRetrieve(store, q.question, await embed(q.question), { topK: 5, ...cond.options });
            const top = new Set(r.chunks.map((c) => c.id));
            const answerHit = [...goldIds(q.support.answer, volumes)].some((id) => top.has(id));
            const bridgeHit = [...goldIds(q.support.bridge, volumes)].some((id) => top.has(id));
            answerHits += Number(answerHit);
            bridgeHits += Number(bridgeHit);
            bothHits += Number(answerHit && bridgeHit);
            perQuestion[cond.name].push({ id: q.id, answerHit, bridgeHit, linked: r.linkedEntities, hops: r.hopEntities, facts: r.graphFacts, top5: r.chunks.map((c) => c.id) });
        }
        const n = questions.length;
        rows.push({ condition: cond.name, answerAt5: answerHits / n, bridgeAt5: bridgeHits / n, bothAt5: bothHits / n });
    }

    console.log(`\n### KG-Series${DEV ? ' (dev)' : ''}: ${questions.length} questions (20 asked in volume 2, 20 in volume 3); answer always in the previous volume`);
    console.log('\n| Condition | Answer passage (earlier volume) @5 | Bridge passage (current volume) @5 | Full chain @5 |');
    console.log('|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.condition} | ${pct(r.answerAt5)} | ${pct(r.bridgeAt5)} | ${pct(r.bothAt5)} |`);
    console.log(`\nFull results: ${writeResult(DEV ? 'ablation-series-dev.json' : 'ablation-series.json', { kg: kg.stats, rows, perQuestion })}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
