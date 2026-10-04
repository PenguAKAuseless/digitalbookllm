/**
 * Experiment 2: answers, hallucination and citations on one book.
 *
 * Question: with the book's passages in the prompt, does the assistant answer
 * correctly, decline questions the book cannot answer, and cite passages that
 * actually hold the evidence?
 *
 * Data (test splits; questions and answers are the datasets' own annotations)
 *   UIT-ViQuAD 2.0 validation: 156 answerable questions (of 306) and 156 unanswerable
 *     ones (of 156, annotated `is_impossible`), drawn with a fixed seed (42)
 *   HotpotQA distractor validation: all 17 multi-hop questions of the test book
 *
 * Conditions (same model, temperature 0, top-k = 5)
 *   closed_book   no retrieval: the question alone
 *   rag_no_kg     production retrieval and prompt, knowledge graph off
 *   rag_full      production: dense + BM25 + knowledge graph
 *
 * Metrics
 *   accuracy          the reference answer appears in the answer (normalised); token F1
 *   over-abstention   declining an answerable question
 *   hallucination     answering an unanswerable question instead of declining
 *   citation support  share of [n]-cited passages that hold annotated evidence, against
 *                     the retrieved passages the answer did not cite
 *
 * Usage: npm run experiment:answers   (local model, see local-model.ts)
 * Output: eval/results/experiment-2-answers.json
 */
import './local-model';
import 'dotenv/config';
import { llmRouter } from '../../src/llm/router';
import { LLMMessage } from '../../src/llm/providers/types';
import { hybridRetrieve } from '../../src/retrieval/hybridRetriever';
import { citedPassageIndices } from '../../src/controllers/ragController';
import type { BenchmarkName, BenchmarkQuestion } from './build-benchmark';
import { abstained, containsAnswer, generateAnswer, tokenF1, wrongLanguage } from './answers';
import { buildGraph, chunkBook, embed, embedChunks, goldGroups, loadBenchmark, MemoryStore, pct, PRODUCTION_CHUNKER, writeResult } from './shared';

const N_VIQUAD_ANSWERABLE = parseInt(process.env.N_VIQUAD_ANSWERABLE || '156');
const N_VIQUAD_UNANSWERABLE = parseInt(process.env.N_VIQUAD_UNANSWERABLE || '156');
const CONDITIONS = (process.env.CONDITIONS || 'closed_book,rag_no_kg,rag_full').split(',');
/** Graph facts in the rag_full prompt: production sends only the relations that link to another book. */
const FACTS = (process.env.FACTS || 'linked') as 'linked' | 'all' | 'none';
const BOOKS = (process.env.BOOKS || 'hotpot-test,viquad-test').split(',') as BenchmarkName[];
const RESULT_FILE = process.env.RESULT_FILE || 'experiment-2-answers.json';

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

const failures: Array<{ book: string; condition: string; id: string }> = [];

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
    const chunks = await chunkBook(bench.document, PRODUCTION_CHUNKER);
    const store = new MemoryStore(chunks, await embedChunks(chunks), graph);
    const golds = new Map(sample.map((q) => [q.id, new Set(goldGroups(q, bench.document, chunks).flat())]));

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
                const options = condition === 'rag_no_kg' ? { lexical: true, graph: false } : { lexical: true, graph: true, embed, facts: FACTS };
                const r = await hybridRetrieve(store, q.question, await embed(q.question), { topK: 5, ...options });
                const gold = golds.get(q.id)!;
                passages = r.chunks.map((c) => ({ text: c.text, goldEvidence: gold.has(c.id) }));
                graphFacts = r.graphFacts;
                messages = llmRouter.buildMessages(q.question, undefined, passages, graphFacts);
            }

            let gen: { answer: string; model: string };
            try {
                gen = await generateAnswer(`${name}|${condition}|${q.id}`, messages);
            } catch (err: any) {
                // Not cached: a re-run retries it. Counted apart, never as an answer or an abstention.
                console.warn(`[${name}] ${condition} ${q.id} failed: ${String(err?.message || err).slice(0, 160)}`);
                failures.push({ book: name, condition, id: q.id });
                continue;
            }
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
    if (failures.length) console.log(`Failed generations (excluded, retried on the next run): ${failures.length}`);
    console.log(`Full results: ${writeResult(RESULT_FILE, { timestamp: new Date().toISOString(), summary, items, failures })}`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
