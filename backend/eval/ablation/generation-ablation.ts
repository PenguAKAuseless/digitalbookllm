/**
 * Generation ablation on the TEST books, scored deterministically against
 * the datasets' own annotations (no LLM judge):
 *
 *   closed_book   same LLM, no retrieval
 *   rag_baseline  the system before this change: old chunker, dense top-5, old prompt
 *   rag_no_kg     current chunker, dense + BM25, current prompt, no graph
 *   rag_full      production: dense + BM25 + knowledge graph, graph facts in the prompt
 *
 * Metrics
 *   answer accuracy   the reference answer appears in the answer (normalised), and token F1
 *                     (official SQuAD / HotpotQA normalisation)
 *   hallucination     on UIT-ViQuAD unanswerable questions: answering instead of abstaining
 *   over-abstention   abstaining on an answerable question
 *   citation support  share of [n]-cited passages that contain an annotated evidence span
 *                     (answer span for ViQuAD, supporting sentence for HotpotQA), compared
 *                     with the retrieved passages the answer did not cite
 *
 * LLM output is cached per (book, condition, question) in
 * eval/results/generation-cache.jsonl; re-runs only spend quota on what is missing.
 *
 * Every condition uses the same generator at temperature 0. With Ollama (no quota):
 *   OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b-8k GROQ_API_KEY=  *   npx ts-node eval/ablation/generation-ablation.ts
 * (an empty GROQ_API_KEY keeps the router from falling back to a different model)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { llmRouter } from '../../src/llm/router';
import { LLMMessage } from '../../src/llm/providers/types';
import { hybridRetrieve } from '../../src/retrieval/hybridRetriever';
import { citedPassageIndices } from '../../src/controllers/ragController';
import type { BenchmarkName, BenchmarkQuestion } from './build-benchmark';
import { CURRENT_CHUNKER } from './retrieval-ablation';
import * as shared from './shared';
import { BASELINE_CHUNKER, buildGraph, chunkBook, embed, embedChunks, goldGroups, installGroqRateLimiter, loadBenchmark, MemoryStore, pct, RESULTS_DIR, writeResult } from './shared';

const N_VIQUAD_ANSWERABLE = parseInt(process.env.N_VIQUAD_ANSWERABLE || '15');
const N_VIQUAD_UNANSWERABLE = parseInt(process.env.N_VIQUAD_UNANSWERABLE || '5');
const CONDITIONS = (process.env.CONDITIONS || 'closed_book,rag_baseline,rag_no_kg,rag_full').split(',');
/** Fact mode for rag_full; the production default unless overridden for a comparison. */
const FACTS = (process.env.FACTS || 'linked') as 'linked' | 'all' | 'none';
const BOOKS = (process.env.BOOKS || 'hotpot-test,viquad-test').split(',') as BenchmarkName[];
const CACHE_FILE = path.join(RESULTS_DIR, 'generation-cache.jsonl');
/** Part of the cache key, so answers from different generators are never mixed. */
export const GENERATOR = process.env.OLLAMA_BASE_URL ? `ollama/${process.env.OLLAMA_MODEL}` : `groq/${process.env.GROQ_MODEL || 'openai/gpt-oss-120b'}`;

/** The RAG prompt before this change (router.buildMessages at commit 7bcbc18), for the baseline condition. */
function baselinePrompt(query: string, passages: string[]): LLMMessage[] {
    const context = passages.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
    return [
        {
            role: 'system',
            content:
                'You are an assistant embedded in a document reader. Answer strictly from the provided context. ' +
                'If the selected text is present, treat it as mandatory context the answer must engage with. ' +
                'If the answer is not supported by the context, say so. Be concise.',
        },
        { role: 'user', content: `**Retrieved document context:**\n${context}\n\n**Question:** ${query}` },
    ];
}

// ------------------------------------------------------------------ cache

const cache = new Map<string, any>();
if (fs.existsSync(CACHE_FILE)) {
    for (const line of fs.readFileSync(CACHE_FILE, 'utf-8').split('\n').filter(Boolean)) {
        const { key, value } = JSON.parse(line);
        cache.set(key, value);
    }
}
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (cache.has(key)) return cache.get(key);
    const value = await fn();
    cache.set(key, value);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.appendFileSync(CACHE_FILE, JSON.stringify({ key, value }) + '\n');
    return value;
}

// ---------------------------------------------------------------- scoring

/** SQuAD/HotpotQA answer normalisation; English articles are only removed for English. */
export function normalizeAnswer(s: string, language: 'en' | 'vi'): string {
    let t = s.normalize('NFC').toLowerCase().replace(/\[\d+(?:\s*[,;]\s*\d+)*\]/g, ' ');
    t = t.replace(/[\p{P}\p{S}]/gu, ' ');
    if (language === 'en') t = t.replace(/\b(a|an|the)\b/g, ' ');
    return t.replace(/\s+/g, ' ').trim();
}

export function tokenF1(prediction: string, gold: string, language: 'en' | 'vi'): number {
    const p = normalizeAnswer(prediction, language).split(' ').filter(Boolean);
    const g = normalizeAnswer(gold, language).split(' ').filter(Boolean);
    if (p.length === 0 || g.length === 0) return Number(p.length === g.length);
    const counts = new Map<string, number>();
    for (const t of g) counts.set(t, (counts.get(t) ?? 0) + 1);
    let common = 0;
    for (const t of p) {
        const c = counts.get(t) ?? 0;
        if (c > 0) {
            common++;
            counts.set(t, c - 1);
        }
    }
    if (common === 0) return 0;
    const precision = common / p.length;
    const recall = common / g.length;
    return (2 * precision * recall) / (precision + recall);
}

export function containsAnswer(answer: string, golds: string[], language: 'en' | 'vi'): boolean {
    const a = ` ${normalizeAnswer(answer, language)} `;
    return golds.some((g) => {
        const n = normalizeAnswer(g, language);
        return n.length > 0 && a.includes(` ${n} `);
    });
}

const ABSTAIN = [
    /\b(not (mentioned|provided|stated|specified|included|available|supported|found|given|covered|contain)|no (information|mention|details?)|does(n't| not) (say|mention|state|specify|contain|provide|include)|cannot (find|determine|answer|be determined)|can't (find|determine|answer)|unable to|(do not|don't) know|not enough information|insufficient)\b/i,
    /(không (được )?(đề cập|nêu|cung cấp|nhắc|chứa|có thông tin|có dữ liệu|tìm thấy|xác định|thể (xác định|trả lời|tìm))|chưa (được )?(đề cập|nêu)|không rõ|không biết|không đủ thông tin|thiếu thông tin)/i,
    // Qwen sometimes answers in Chinese whatever the question's language; its refusals count as refusals.
    /(未提供|未提及|没有提及|并未提及|没有关于|无法回答|无法确定|没有相关信息)/,
];
export const abstained = (answer: string) => ABSTAIN.some((re) => re.test(answer));
/** Answer written in a script the question is not in (e.g. Chinese for a Vietnamese question). */
export const wrongLanguage = (answer: string) => /[\u3400-\u9fff]/.test(answer);

// ------------------------------------------------------------------- main

function seededShuffle<T>(items: T[], seed: number): T[] {
    const out = [...items];
    let s = seed >>> 0;
    const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

interface Item {
    book: BenchmarkName;
    condition: string;
    id: string;
    question: string;
    isImpossible: boolean;
    references: string[];
    answer: string;
    model: string;
    graphFacts: string[];
    passages: Array<{ goldEvidence: boolean; cited: boolean }>;
    containsAnswer: boolean;
    f1: number;
    abstained: boolean;
    wrongLanguage: boolean;
}

async function runBook(name: BenchmarkName): Promise<Item[]> {
    const bench = loadBenchmark(name);
    const sample: BenchmarkQuestion[] =
        name === 'viquad-test'
            ? [
                  ...seededShuffle(bench.questions.filter((q) => !q.isImpossible), 42).slice(0, N_VIQUAD_ANSWERABLE),
                  ...seededShuffle(bench.questions.filter((q) => q.isImpossible), 42).slice(0, N_VIQUAD_UNANSWERABLE),
              ]
            : bench.questions;

    const graph = await buildGraph(bench);
    const setups: Record<string, { store: MemoryStore; golds: Map<string, Set<string>> }> = {};
    for (const [label, cfg] of [['baseline', BASELINE_CHUNKER], ['current', CURRENT_CHUNKER]] as const) {
        const chunks = await chunkBook(bench.document, cfg);
        const golds = new Map(sample.map((q) => [q.id, new Set(goldGroups(q, bench.document, chunks).flat())]));
        setups[label] = { store: new MemoryStore(chunks, await embedChunks(chunks), graph), golds };
    }

    const items: Item[] = [];
    for (const condition of CONDITIONS) {
        for (const [n, q] of sample.entries()) {
            let messages: LLMMessage[];
            let passages: Array<{ text: string; goldEvidence: boolean }> = [];
            let graphFacts: string[] = [];

            if (condition === 'closed_book') {
                messages = [
                    { role: 'system', content: 'You are a helpful assistant. Answer the question concisely.' },
                    { role: 'user', content: q.question },
                ];
            } else {
                const setup = setups[condition === 'rag_baseline' ? 'baseline' : 'current'];
                const options =
                    condition === 'rag_baseline'
                        ? { lexical: false, graph: false, weights: { dense: 1, lexical: 1 } }
                        : condition === 'rag_no_kg'
                          ? { lexical: true, graph: false }
                          : { lexical: true, graph: true, embed, facts: FACTS };
                const r = await hybridRetrieve(setup.store, q.question, await embed(q.question), { topK: 5, ...options });
                const gold = setup.golds.get(q.id)!;
                passages = r.chunks.map((c) => ({ text: c.text, goldEvidence: gold.has(c.id) }));
                graphFacts = r.graphFacts;
                messages =
                    condition === 'rag_baseline'
                        ? baselinePrompt(q.question, passages.map((p) => p.text))
                        : llmRouter.buildMessages(q.question, undefined, passages, graphFacts);
            }

            // rag_full's prompt depends on the fact mode, so it is part of the key; the first runs used 'all'.
            const variant = condition === 'rag_full' && FACTS !== 'all' ? `|facts=${FACTS}` : '';
            const gen = await cached(`${name}|${condition}|${q.id}|${GENERATOR}${variant}`, async () => {
                const result = await llmRouter.generate(messages, { temperature: 0 });
                return { answer: result.text, model: result.provider === 'Ollama' ? `ollama/${process.env.OLLAMA_MODEL}` : shared.lastGroqModel };
            });
            const cited = new Set(citedPassageIndices(gen.answer, passages.length));
            const lang = bench.language;
            items.push({
                book: name,
                condition,
                id: q.id,
                question: q.question,
                isImpossible: q.isImpossible,
                references: q.answers,
                answer: gen.answer,
                model: gen.model,
                graphFacts,
                passages: passages.map((p, i) => ({ goldEvidence: p.goldEvidence, cited: cited.has(i + 1) })),
                containsAnswer: !q.isImpossible && containsAnswer(gen.answer, q.answers, lang),
                f1: q.isImpossible ? 0 : Math.max(...q.answers.map((g) => tokenF1(gen.answer, g, lang))),
                abstained: abstained(gen.answer),
                wrongLanguage: wrongLanguage(gen.answer),
            });
            console.log(`[${name}] ${condition} ${n + 1}/${sample.length}`);
        }
    }
    return items;
}

function summarize(items: Item[]) {
    const rows = [];
    for (const book of [...new Set(items.map((i) => i.book))]) {
        for (const condition of CONDITIONS) {
            const set = items.filter((i) => i.book === book && i.condition === condition);
            const ans = set.filter((i) => !i.isImpossible);
            const unans = set.filter((i) => i.isImpossible);
            const share = (xs: Item[], f: (i: Item) => boolean) => (xs.length ? xs.filter(f).length / xs.length : null);
            const shown = ans.flatMap((i) => i.passages);
            const citedP = shown.filter((p) => p.cited);
            const uncitedP = shown.filter((p) => !p.cited);
            rows.push({
                book,
                condition,
                answerable: ans.length,
                unanswerable: unans.length,
                accuracy: share(ans, (i) => i.containsAnswer),
                f1: ans.length ? ans.reduce((s, i) => s + i.f1, 0) / ans.length : null,
                overAbstention: share(ans, (i) => i.abstained),
                hallucinationOnUnanswerable: share(unans, (i) => !i.abstained),
                wrongLanguage: share(set, (i) => i.wrongLanguage),
                answersWithCitations: condition === 'closed_book' ? null : share(ans, (i) => i.passages.some((p) => p.cited)),
                citedPassagesWithEvidence: citedP.length ? citedP.filter((p) => p.goldEvidence).length / citedP.length : null,
                uncitedPassagesWithEvidence: uncitedP.length ? uncitedP.filter((p) => p.goldEvidence).length / uncitedP.length : null,
                models: [...new Set(set.map((i) => i.model))],
            });
        }
    }
    return rows;
}

async function main() {
    const log = installGroqRateLimiter();
    const items: Item[] = [];
    for (const name of BOOKS) items.push(...(await runBook(name)));
    const summary = summarize(items);

    console.log('\n| Book | Condition | Accuracy | F1 | Over-abstention | Hallucination on unanswerable | Answers citing [n] | Cited passages with evidence | Uncited passages with evidence | Wrong-language answers | Models |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of summary) {
        console.log(
            `| ${r.book} | ${r.condition} | ${pct(r.accuracy)} | ${r.f1 === null ? '–' : r.f1.toFixed(3)} | ${pct(r.overAbstention)} | ${pct(r.hallucinationOnUnanswerable)} | ${pct(r.answersWithCitations)} | ${pct(r.citedPassagesWithEvidence)} | ${pct(r.uncitedPassagesWithEvidence)} | ${pct(r.wrongLanguage)} | ${r.models.join(', ')} |`
        );
    }
    console.log(`\nLLM calls this run: ${log.length} (${log.reduce((s, c) => s + c.tokens, 0)} tokens)`);
    console.log(`Full results: ${writeResult('ablation-generation.json', { timestamp: new Date().toISOString(), summary, items })}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
