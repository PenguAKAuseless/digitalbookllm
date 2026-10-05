/**
 * Experiment 3: knowledge graph across books (KG-Series, eval/datasets/kg-series).
 *
 * Question: when a question asked while reading one book can only be answered
 * from a book read earlier, does the knowledge graph bring that passage, and
 * the right answer, into the reply?
 *
 * Data: KG-Series, 3 volumes built from HotpotQA distractor validation (test),
 * 40 bridge questions taken in dataset order. Every answer is in the volume
 * read before the one the question is asked in, never in the open one.
 * Reading order is simulated: a question asked in volume v sees volumes 1..v
 * and a graph extracted from those volumes only.
 *
 * Retrieval conditions (top-k = 5)
 *   open book only        dense + BM25 over the open book
 *   all books, 1 search   dense + BM25 over every volume read so far
 *   2nd pass, plain       open book, then a second search over earlier volumes
 *   2nd pass, KG-guided   the second pass led by graph entities
 *   production            the second pass re-ranked by the graph
 * Answer conditions add the graph relations given to the model (none, all, or
 * only those linking to another book = production).
 *
 * Metrics: answer@5 / bridge@5 / chain@5 (annotated evidence of the earlier /
 * current volume / both retrieved); answer accuracy, abstention, citations.
 * Production is compared with the no-KG second pass by an exact McNemar test.
 *
 * Usage: npm run experiment:kg-series   (local model; SERIES=dev for the dev copy)
 * Output: eval/results/experiment-3-kg-series.json
 */
import './local-model';
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEntity, GraphRelation } from '../../src/retrieval/graphSignals';
import { CorpusChunk, hybridRetrieve, linkFacts, RetrievalOptions, RetrievalStore, ScopeCorpus } from '../../src/retrieval/hybridRetriever';
import type { SeriesQuestion, SeriesSpan } from './build-series';
import { PRODUCTION_CHUNKER, buildGraph, chunkBook, chunksContainingSpan, ChunkerConfig, embed, embedChunks, normalize, pct, writeResult } from './shared';
import { llmRouter } from '../../src/llm/router';
import { citedPassageIndices } from '../../src/controllers/ragController';
import { abstained, containsAnswer, generateAnswer, normalizeAnswer, tokenF1 } from './answers';

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
 * Answer generation on the series, with the production prompt
 * (llmRouter.buildMessages) at temperature 0. Scored against HotpotQA's
 * reference answers; a citation counts as supported when the cited passage
 * contains an annotated supporting sentence.
 */
async function generate(questions: SeriesQuestion[], kg: Awaited<ReturnType<typeof seriesGraph>>, volumes: VolumeIndex[]) {
    // `plainFacts`: the plain second pass's passages, unchanged, plus the KG relations linking them
    // (the production fact selection): isolates what the relations themselves add, apart from re-ranking.
    const conditions: Array<{ name: string; options: Omit<RetrievalOptions, 'topK'>; facts: boolean; plainFacts?: boolean }> = [
        { name: 'doc only (no 2nd pass, no KG)', options: { graph: false }, facts: false },
        { name: '2nd pass, plain (no KG)', options: { graph: false, secondPass: 'plain' }, facts: false },
        { name: '2nd pass, plain + linking KG facts (no re-ranking)', options: { graph: false, secondPass: 'plain' }, facts: true, plainFacts: true },
        { name: '2nd pass re-ranked by KG, no facts', options: { graph: true, embed, facts: 'none' }, facts: false },
        { name: '2nd pass re-ranked by KG + all KG facts', options: { graph: true, embed, facts: 'all' }, facts: true },
        { name: 'production: 2nd pass re-ranked by KG + linking facts', options: { graph: true, embed, facts: 'linked' }, facts: true },
    ];
    const rows = [];
    const items: unknown[] = [];
    for (const cond of conditions) {
        let correct = 0, f1 = 0, abst = 0, citedEarlier = 0, citedTotal = 0, citedSupported = 0, factsWithAnswer = 0;
        for (const [n, q] of questions.entries()) {
            const store = new SeriesStore(volumes, q.askedIn, kg, false);
            const r = await hybridRetrieve(store, q.question, await embed(q.question), { topK: 5, ...cond.options });
            if (cond.plainFacts) {
                const graph = await store.graph();
                r.graphFacts = linkFacts(q.question, r.chunks, await store.corpus(), graph.entities, graph.relations);
            }
            const facts = cond.facts ? r.graphFacts : [];
            // The KG brings the answer itself: a relation in the prompt names the reference answer.
            if (facts.some((f) => ` ${normalizeAnswer(f, 'en')} `.includes(` ${normalizeAnswer(q.answer, 'en')} `))) factsWithAnswer++;
            const gold = new Set([...goldIds(q.support.answer, volumes), ...goldIds(q.support.bridge, volumes)]);
            const messages = llmRouter.buildMessages(q.question, undefined, r.chunks, facts);
            const gen = await generateAnswer(`series${DEV ? '-dev' : ''}|${cond.name}|${q.id}`, messages);
            const cited = citedPassageIndices(gen.answer, r.chunks.length).map((i) => r.chunks[i - 1]);
            const hit = containsAnswer(gen.answer, [q.answer], 'en');
            correct += Number(hit);
            f1 += tokenF1(gen.answer, q.answer, 'en');
            abst += Number(abstained(gen.answer));
            citedTotal += cited.length;
            citedEarlier += cited.filter((c) => c.document_id !== `vol${q.askedIn}`).length;
            citedSupported += cited.filter((c) => gold.has(c.id)).length;
            items.push({ condition: cond.name, id: q.id, question: q.question, reference: q.answer, answer: gen.answer, model: gen.model, facts, correct: hit });
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
            factsHoldAnswer: factsWithAnswer / N,
        });
    }
    console.log('\n| Condition | Answer accuracy | F1 | Abstained | Cited passages / answer | Cited from earlier volume | Cited passages holding annotated evidence | KG facts naming the answer |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
        console.log(`| ${r.condition} | ${pct(r.accuracy)} | ${r.f1.toFixed(3)} | ${pct(r.abstained)} | ${r.citedPassagesPerAnswer.toFixed(2)} | ${pct(r.citedFromEarlierVolume)} | ${pct(r.citedPassagesWithEvidence)} | ${pct(r.factsHoldAnswer)} |`);
    }

    // Paired exact McNemar test: production against each other condition, on the same 40 questions.
    const production = conditions[conditions.length - 1].name;
    const correctBy = (name: string) => new Map((items as Array<{ condition: string; id: string; correct: boolean }>).filter((i) => i.condition === name).map((i) => [i.id, i.correct]));
    const prod = correctBy(production);
    const mcnemar = conditions.slice(0, -1).map((c) => {
        const other = correctBy(c.name);
        let onlyProduction = 0, onlyOther = 0;
        for (const [id, ok] of prod) {
            if (ok && !other.get(id)) onlyProduction++;
            if (!ok && other.get(id)) onlyOther++;
        }
        return { against: c.name, onlyProduction, onlyOther, p: exactMcNemar(onlyProduction, onlyOther) };
    });
    console.log('\n| Production vs | Correct only with production | Correct only with the other | p (exact McNemar) |');
    console.log('|---|---|---|---|');
    for (const m of mcnemar) console.log(`| ${m.against} | ${m.onlyProduction} | ${m.onlyOther} | ${m.p.toFixed(3)} |`);

    // What the KG relations add on identical passages: plain second pass with vs without the facts.
    const withFacts = correctBy('2nd pass, plain + linking KG facts (no re-ranking)');
    const without = correctBy('2nd pass, plain (no KG)');
    let onlyWith = 0, onlyWithout = 0;
    for (const [id, ok] of withFacts) {
        if (ok && !without.get(id)) onlyWith++;
        if (!ok && without.get(id)) onlyWithout++;
    }
    const factsEffect = { onlyWithFacts: onlyWith, onlyWithoutFacts: onlyWithout, p: exactMcNemar(onlyWith, onlyWithout) };
    console.log(`\nKG facts on identical passages (plain 2nd pass): correct only with facts ${onlyWith}, only without ${onlyWithout}, p = ${factsEffect.p.toFixed(3)}`);
    return { rows, items, mcnemar, factsEffect };
}

/** Two-sided exact McNemar p-value: a binomial test on the discordant pairs. */
function exactMcNemar(b: number, c: number): number {
    const n = b + c;
    if (n === 0) return 1;
    let tail = 0;
    for (let k = 0; k <= Math.min(b, c); k++) tail += binomial(n, k);
    return Math.min(1, (2 * tail) / 2 ** n);
}

function binomial(n: number, k: number): number {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
}

type RetrievalCondition = { name: string; workspace: boolean; options: Omit<RetrievalOptions, 'topK'> };

/** Retrieval metrics per condition: annotated evidence of the earlier / current volume in the top 5. */
async function retrieve(questions: SeriesQuestion[], kg: Awaited<ReturnType<typeof seriesGraph>>, volumes: VolumeIndex[], conditions: RetrievalCondition[]) {
    const rows = [];
    const perQuestion: Record<string, unknown[]> = {};
    for (const cond of conditions) {
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
    return { rows, perQuestion };
}

/**
 * The retrieval conditions again at top-k = 1..5: with 5 slots most conditions reach the
 * earlier volume, so whether the graph puts the right passage *first* only shows at small k.
 */
async function retrievalByK(questions: SeriesQuestion[], kg: Awaited<ReturnType<typeof seriesGraph>>, volumes: VolumeIndex[], conditions: RetrievalCondition[]) {
    const rows: Array<{ condition: string; k: number; answerAtK: number; chainAtK: number }> = [];
    for (const cond of conditions) {
        for (let k = 1; k <= 5; k++) {
            let answerHits = 0, chainHits = 0;
            for (const q of questions) {
                const store = new SeriesStore(volumes, q.askedIn, kg, cond.workspace);
                const r = await hybridRetrieve(store, q.question, await embed(q.question), { topK: k, ...cond.options });
                const top = new Set(r.chunks.map((c) => c.id));
                const answerHit = [...goldIds(q.support.answer, volumes)].some((id) => top.has(id));
                const bridgeHit = [...goldIds(q.support.bridge, volumes)].some((id) => top.has(id));
                answerHits += Number(answerHit);
                chainHits += Number(answerHit && bridgeHit);
            }
            rows.push({ condition: cond.name, k, answerAtK: answerHits / questions.length, chainAtK: chainHits / questions.length });
        }
    }
    console.log('\n| Condition | answer@1 | answer@2 | answer@3 | answer@4 | answer@5 | chain@2 | chain@3 | chain@5 |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const cond of conditions) {
        const at = (k: number) => rows.find((r) => r.condition === cond.name && r.k === k)!;
        console.log(`| ${cond.name} | ${[1, 2, 3, 4, 5].map((k) => pct(at(k).answerAtK)).join(' | ')} | ${[2, 3, 5].map((k) => pct(at(k).chainAtK)).join(' | ')} |`);
    }
    return rows;
}

async function main() {
    const questions: SeriesQuestion[] = JSON.parse(fs.readFileSync(path.join(DATASET, 'questions.json'), 'utf-8'));
    const kg = await seriesGraph();
    for (const s of kg.stats) console.log(`graph volume ${s.volume}: ${s.ok}/${s.windows} windows, ${s.entities} entities, ${s.relations} relations (${s.models.join(', ')})`);
    console.log(`merged graph: ${kg.entities.length} entities, ${kg.relations.length} relations`);
    if (process.env.KG_ONLY) return;

    const volumes = await indexVolumes(PRODUCTION_CHUNKER);
    const conditions: RetrievalCondition[] = [
        { name: 'open book only (no KG)', workspace: false, options: { graph: false } },
        { name: 'all books read, one search (no KG)', workspace: true, options: { graph: false } },
        { name: '2nd pass over earlier books, plain question (no KG)', workspace: false, options: { graph: false, secondPass: 'plain' } },
        { name: '2nd pass, KG-guided searches + plain fill', workspace: false, options: { graph: true, secondPass: 'graph+plain', embed } },
        { name: 'production: 2nd pass re-ranked by KG', workspace: false, options: { graph: true, embed } },
        // Variants compared on the dev copy only, to choose the production settings.
        ...(DEV
            ? [1, 2].flatMap((hopSlots) =>
                  (['plain', 'graph+plain', 'rerank'] as const).map((secondPass) => ({
                      name: `${secondPass}, ${hopSlots} slot(s)`,
                      workspace: false,
                      options: { graph: secondPass !== 'plain', secondPass, hopSlots, embed },
                  }))
              )
            : []),
    ];

    const { rows, perQuestion } = await retrieve(questions, kg, volumes, conditions);

    console.log(`\n### KG-Series${DEV ? ' (dev)' : ''}: ${questions.length} questions (20 asked in volume 2, 20 in volume 3); answer always in the previous volume`);
    console.log('\n| Condition | Answer passage (earlier volume) @5 | Bridge passage (current volume) @5 | Full chain @5 |');
    console.log('|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.condition} | ${pct(r.answerAt5)} | ${pct(r.bridgeAt5)} | ${pct(r.bothAt5)} |`);

    const byK = await retrievalByK(questions, kg, volumes, conditions);

    const answers = await generate(questions, kg, volumes);
    const file = DEV ? 'experiment-3-kg-series-dev.json' : 'experiment-3-kg-series.json';
    console.log(`\nFull results: ${writeResult(file, { kg: kg.stats, retrieval: { rows, perQuestion, byK }, answers })}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
