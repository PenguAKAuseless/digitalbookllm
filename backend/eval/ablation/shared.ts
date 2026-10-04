/**
 * Shared by the evaluation scripts: benchmark loading, gold-chunk matching,
 * an in-memory RetrievalStore (same interface the production pgvector store
 * implements, so the *production* hybridRetrieve() is what gets measured),
 * knowledge-graph construction through the production extractor, metrics,
 * and a Groq rate limiter.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Chunker } from '../../src/chunking/chunker';
import { embeddingService } from '../../src/llm/embeddings';
import { GraphEntity, GraphRelation } from '../../src/retrieval/graphSignals';
import { CorpusChunk, RetrievalStore, ScopeCorpus } from '../../src/retrieval/hybridRetriever';
import { extractionWindows, extractWindowGraph } from '../../src/queue/handlers/extractEntities';
import type { Benchmark, BenchmarkName, BenchmarkQuestion } from './build-benchmark';

export const RESULTS_DIR = path.join(__dirname, '..', 'results');
const DATA_DIR = path.join(__dirname, 'data');

export function loadBenchmark(name: BenchmarkName): Benchmark {
    const file = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run: npx ts-node eval/ablation/build-benchmark.ts`);
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
const CONTEXT_CHARS = 20;

/**
 * Position-based ground truth: a chunk is gold for a span if it contains the
 * span at its annotated location (span plus 20 neighbouring characters on
 * one side), or the span text when it occurs only once in the book.
 * Whitespace is normalised because the chunker re-joins sentences.
 */
export function chunksContainingSpan(span: { text: string; start: number }, document: string, normChunks: string[]): number[] {
    const text = normalize(span.text);
    const left = normalize(document.slice(Math.max(0, span.start - CONTEXT_CHARS), span.start + span.text.length));
    const right = normalize(document.slice(span.start, span.start + span.text.length + CONTEXT_CHARS));
    const unique = document.indexOf(span.text) === document.lastIndexOf(span.text);
    return normChunks.flatMap((c, i) => (c.includes(left) || c.includes(right) || (unique && c.includes(text)) ? [i] : []));
}

/** Gold chunk ids for each support group of a question. */
export function goldGroups(q: BenchmarkQuestion, document: string, chunks: CorpusChunk[]): string[][] {
    const norm = chunks.map((c) => normalize(c.text));
    return q.supportGroups.map((group) => [
        ...new Set(group.flatMap((s) => chunksContainingSpan(q.spans[s], document, norm).map((i) => chunks[i].id))),
    ]);
}

// --------------------------------------------------------------- chunking

export interface ChunkerConfig {
    size: number;
    overlap: number;
    threshold: number;
    minChars: number;
}

/** The chunker before this change: same pipeline, no merging of short semantic pieces. */
export const BASELINE_CHUNKER: ChunkerConfig = { size: 1800, overlap: 200, threshold: 0.45, minChars: 0 };

export async function chunkBook(document: string, cfg: ChunkerConfig): Promise<CorpusChunk[]> {
    const cachedEmbed = async (texts: string[]) => {
        const out: number[][] = [];
        for (const t of texts) out.push(await embed(t));
        return out;
    };
    const pieces = await new Chunker(cfg.size, cfg.overlap, cfg.threshold, cfg.minChars, cachedEmbed).chunk(document);
    return pieces.map((p, i) => ({ id: `c${i}`, text: p.text, page_number: null, document_id: 'book' }));
}

const vectorCache = new Map<string, number[]>();
/** Production embedding model (src/llm/embeddings.ts), memoised by text. */
export async function embed(text: string): Promise<number[]> {
    let v = vectorCache.get(text);
    if (!v) {
        v = await embeddingService.generateEmbedding(text);
        vectorCache.set(text, v);
    }
    return v;
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

// ------------------------------------------------------- in-memory store

export class MemoryStore implements RetrievalStore {
    private corpusObj: ScopeCorpus;

    constructor(chunks: CorpusChunk[], private vectors: Map<string, number[]>, private kg: { entities: GraphEntity[]; relations: GraphRelation[] }) {
        this.corpusObj = new ScopeCorpus(chunks);
    }

    /** Exact cosine ranking (vectors are L2-normalised): what pgvector's ORDER BY embedding <=> q returns. */
    async denseSearch(q: number[], limit: number) {
        return this.corpusObj.chunks
            .map((c) => ({ id: c.id, similarity: dot(q, this.vectors.get(c.id)!) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    async similarities(ids: string[], q: number[]) {
        return new Map(ids.map((id) => [id, dot(q, this.vectors.get(id)!)]));
    }

    async corpus() {
        return this.corpusObj;
    }

    async graph() {
        return this.kg;
    }
}

export async function embedChunks(chunks: CorpusChunk[]): Promise<Map<string, number[]>> {
    const vectors = new Map<string, number[]>();
    for (const c of chunks) vectors.set(c.id, await embed(c.text));
    return vectors;
}

// ------------------------------------------------------- knowledge graph

export interface BuiltGraph {
    entities: GraphEntity[];
    relations: GraphRelation[];
    windows: number;
    windowsOk: number;
    models: string[];
}

/**
 * Builds the book's knowledge graph with the production extractor
 * (extractionWindows + extractWindowGraph, same prompt and budget), merging
 * entities by case-insensitive name and skipping duplicate edges exactly as
 * the worker does. Each window's LLM output is cached on disk.
 */
export async function buildGraph(bench: Benchmark): Promise<BuiltGraph> {
    const cacheFile = path.join(RESULTS_DIR, `kg-cache-${bench.name}.json`);
    const cache: Record<string, any> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) : {};
    const windows = extractionWindows(bench.document);

    const byKey = new Map<string, GraphEntity>();
    const relations: GraphRelation[] = [];
    const edgeKeys = new Set<string>();
    const models = new Set<string>();
    let ok = 0;

    const resolve = (name: unknown, type?: unknown): GraphEntity | null => {
        const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (!clean) return null;
        const key = clean.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, { id: `e${byKey.size}`, name: clean, type: typeof type === 'string' ? type : 'concept' });
        return byKey.get(key)!;
    };

    for (const [w, window] of windows.entries()) {
        const key = createHash('sha1').update(window).digest('hex');
        if (!cache[key]) {
            try {
                const known = [...byKey.values()].slice(-40).map((e) => e.name);
                const extracted = await extractWindowGraph(window, known);
                cache[key] = { ...extracted, model: process.env.OLLAMA_BASE_URL ? `ollama/${process.env.OLLAMA_MODEL}` : lastGroqModel };
                fs.mkdirSync(RESULTS_DIR, { recursive: true });
                fs.writeFileSync(cacheFile, JSON.stringify(cache));
            } catch (err: any) {
                console.warn(`[kg ${bench.name}] window ${w + 1}/${windows.length} failed: ${String(err?.message).slice(0, 160)}`);
                continue;
            }
        }
        const { entities, relations: rels, model } = cache[key];
        if (model) models.add(model);
        ok++;
        for (const e of entities) resolve(e.name, e.type);
        for (const r of rels) {
            const s = resolve(r.source);
            const t = resolve(r.target);
            if (!s || !t || s === t) continue;
            const type = (typeof r.type === 'string' && r.type.trim()) || 'related_to';
            const edge = `${s.id}|${t.id}|${type}`;
            if (edgeKeys.has(edge)) continue;
            edgeKeys.add(edge);
            relations.push({ sourceId: s.id, targetId: t.id, type });
        }
        console.log(`[kg ${bench.name}] window ${w + 1}/${windows.length}: ${byKey.size} entities, ${relations.length} relations`);
    }
    return { entities: [...byKey.values()], relations, windows: windows.length, windowsOk: ok, models: [...models] };
}

// ---------------------------------------------------------------- metrics

export interface RetrievalMetrics {
    questions: number;
    unreachable: number;
    recallAt1: number;
    recallAt3: number;
    recallAt5: number;
    recallAt10: number;
    mrrAt10: number;
    /** Every support group (evidence paragraph) has a gold chunk in the top 5 — the multi-hop criterion. */
    allSupportAt5: number;
    /** Same, top 3: added because all-support@5 saturates on the HotpotQA books. */
    allSupportAt3: number;
}

export function scoreRetrieval(rankings: string[][], golds: string[][][]): RetrievalMetrics {
    const n = rankings.length;
    const firstHit = rankings.map((ranking, i) => {
        const any = new Set(golds[i].flat());
        const pos = ranking.findIndex((id) => any.has(id));
        return pos === -1 ? Infinity : pos + 1;
    });
    const recall = (k: number) => firstHit.filter((r) => r <= k).length / n;
    const allSupport = (k: number) =>
        rankings.filter((ranking, i) => {
            const top = new Set(ranking.slice(0, k));
            return golds[i].length > 0 && golds[i].every((group) => group.some((id) => top.has(id)));
        }).length / n;
    return {
        questions: n,
        unreachable: golds.filter((g) => g.flat().length === 0).length,
        recallAt1: recall(1),
        recallAt3: recall(3),
        recallAt5: recall(5),
        recallAt10: recall(10),
        mrrAt10: firstHit.reduce((s, r) => s + (r <= 10 ? 1 / r : 0), 0) / n,
        allSupportAt5: allSupport(5),
        allSupportAt3: allSupport(3),
    };
}

export const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(1)}%`);

export function writeResult(name: string, data: unknown): string {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const file = path.join(RESULTS_DIR, name);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return file;
}

// ------------------------------------------------------- Groq rate limit

/** Model that served the most recent Groq completion, read from the response. */
export let lastGroqModel = '';

/**
 * Groq's free tier allows 8K tokens per minute per model, counted on prompt
 * + max_tokens. Requests are held until they fit in the model's rolling
 * minute, so the router never gets a 429 and switches model mid-experiment.
 */
export function installGroqRateLimiter(tpmBudget = 7000): Array<{ model: string; tokens: number }> {
    const log: Array<{ model: string; tokens: number }> = [];
    const windowByModel = new Map<string, Array<{ at: number; tokens: number }>>();
    const realFetch = global.fetch;

    global.fetch = (async (input: any, init?: RequestInit) => {
        const url = String(input);
        if (!url.includes('api.groq.com') || !url.endsWith('/chat/completions') || !init?.body) return realFetch(input, init);
        const body = JSON.parse(String(init.body));
        const estimate = Math.ceil(JSON.stringify(body.messages).length / 2.5) + (body.max_tokens ?? 800);
        const window = windowByModel.get(body.model) ?? [];
        windowByModel.set(body.model, window);
        for (;;) {
            const now = Date.now();
            while (window.length && now - window[0].at > 61_000) window.shift();
            if (window.length === 0 || window.reduce((s, w) => s + w.tokens, 0) + estimate <= tpmBudget) break;
            await new Promise((r) => setTimeout(r, Math.max(500, 61_000 - (now - window[0].at))));
        }
        const entry = { at: Date.now(), tokens: estimate };
        window.push(entry);

        const res = await realFetch(input, init);
        if (res.ok) {
            const data: any = await res.clone().json().catch(() => null);
            if (data?.usage) {
                lastGroqModel = data.model ?? body.model;
                log.push({ model: lastGroqModel, tokens: data.usage.total_tokens });
            }
        } else {
            console.warn(`[groq] ${body.model} HTTP ${res.status}`);
        }
        return res;
    }) as typeof fetch;
    return log;
}
