/**
 * Builds the evaluation "books" from two public, peer-reviewed QA datasets:
 *
 *   - UIT-ViQuAD 2.0 (Vietnamese; Nguyen et al., VLSP 2021 shared task):
 *     annotator-written answer spans, plus unanswerable questions
 *     (`is_impossible`) for the hallucination experiment.
 *   - HotpotQA, distractor setting (English; Yang et al., EMNLP 2018):
 *     multi-hop questions whose answer needs two paragraphs, with the
 *     supporting sentences annotated — the case a knowledge graph is for.
 *
 * Each dataset gives a *test* book (validation split, reported) and a *dev*
 * book (train split, used only to choose parameters), so no setting is tuned
 * on the numbers that are reported. Items are taken in dataset order, never
 * hand-picked. Paragraphs are joined like a plain-text upload, with each
 * article title as a heading line, and every gold span is converted to an
 * absolute character offset in the book.
 *
 * Usage: npx ts-node eval/ablation/build-benchmark.ts
 * Output: eval/ablation/data/{viquad,hotpot}-{test,dev}.json (gitignored)
 */
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const ROWS_API = 'https://datasets-server.huggingface.co/rows';

export type BenchmarkName = 'viquad-test' | 'viquad-dev' | 'hotpot-test' | 'hotpot-dev';

export interface BenchmarkQuestion {
    id: string;
    question: string;
    isImpossible: boolean;
    /** Gold evidence spans with absolute offsets into `document`: answer spans (ViQuAD) or supporting sentences (HotpotQA). */
    spans: Array<{ text: string; start: number }>;
    /** Indices into `spans`, one group per evidence paragraph; a question is fully supported when every group is retrieved. */
    supportGroups: number[][];
    /** Reference answers for answer-quality metrics (empty for unanswerable questions). */
    answers: string[];
    /** HotpotQA question type (bridge / comparison). */
    type?: string;
}

export interface Benchmark {
    name: BenchmarkName;
    language: 'en' | 'vi';
    source: string;
    titles: string[];
    document: string;
    questions: BenchmarkQuestion[];
}

async function cachedJson(url: string, file: string): Promise<any> {
    const target = path.join(RAW_DIR, file);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf-8'));
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
            const text = await res.text();
            fs.writeFileSync(target, text);
            return JSON.parse(text);
        } catch (err) {
            if (attempt >= 4) throw err;
            await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
    }
}

/** Accumulates the book text and records where each piece starts. */
class BookBuilder {
    private parts: string[] = [];
    private length = 0;

    append(text: string): number {
        if (this.parts.length > 0) this.length += 2; // "\n\n", as in a plain-text upload
        const start = this.length;
        this.parts.push(text);
        this.length += text.length;
        return start;
    }

    get size(): number {
        return this.length;
    }

    build(): string {
        return this.parts.join('\n\n');
    }
}

// ------------------------------------------------------------------ ViQuAD

const VIQUAD_TARGET_CHARS = 60_000;

/** Nearest exact occurrence of `text` to the annotated offset (a few ViQuAD offsets are off by some characters). */
function realign(context: string, text: string, start: number): number | null {
    if (context.slice(start, start + text.length) === text) return start;
    let best: number | null = null;
    for (let i = context.indexOf(text); i !== -1; i = context.indexOf(text, i + 1)) {
        if (best === null || Math.abs(i - start) < Math.abs(best - start)) best = i;
    }
    return best;
}

async function buildViquad(split: 'validation' | 'train', name: BenchmarkName): Promise<Benchmark> {
    // One row per question; rows sharing a context are one paragraph. Stop at the first
    // article boundary after the target size, so the last article is complete.
    const rows: any[] = [];
    let chars = 0;
    let lastTitle = '';
    const seenContexts = new Set<string>();
    outer: for (let offset = 0; ; offset += 100) {
        const page = await cachedJson(
            `${ROWS_API}?dataset=taidng/UIT-ViQuAD2.0&config=default&split=${split}&offset=${offset}&length=100`,
            `viquad-${split}-${offset}.json`
        );
        if (!page.rows?.length) break;
        for (const { row } of page.rows) {
            if (chars >= VIQUAD_TARGET_CHARS && row.title !== lastTitle) break outer;
            lastTitle = row.title;
            if (!seenContexts.has(row.context)) {
                seenContexts.add(row.context);
                chars += row.context.length;
            }
            rows.push(row);
        }
    }

    const book = new BookBuilder();
    const titles: string[] = [];
    const contextStart = new Map<string, number>();
    const questions: BenchmarkQuestion[] = [];
    let realigned = 0;
    let dropped = 0;

    for (const row of rows) {
        if (titles[titles.length - 1] !== row.title) {
            titles.push(row.title);
            book.append(row.title);
        }
        if (!contextStart.has(row.context)) contextStart.set(row.context, book.append(row.context));
        const base = contextStart.get(row.context)!;

        const texts: string[] = row.answers?.text ?? [];
        const spans = texts
            .map((text, i) => {
                const at = realign(row.context, text, row.answers.answer_start[i]);
                if (at !== null && at !== row.answers.answer_start[i]) realigned++;
                return at === null ? null : { text, start: base + at };
            })
            .filter((s): s is { text: string; start: number } => s !== null);
        if (!row.is_impossible && spans.length === 0) {
            dropped++;
            continue;
        }
        questions.push({
            id: row.id,
            question: row.question,
            isImpossible: Boolean(row.is_impossible),
            spans,
            supportGroups: spans.length ? [spans.map((_, i) => i)] : [],
            answers: [...new Set(texts)],
        });
    }
    if (realigned || dropped) console.log(`${name}: realigned ${realigned} answer offsets, dropped ${dropped} unlocatable questions`);

    return { name, language: 'vi', source: `UIT-ViQuAD 2.0 ${split}`, titles, document: book.build(), questions };
}

// ---------------------------------------------------------------- HotpotQA

const HOTPOT_TARGET_CHARS = 100_000;

async function buildHotpot(split: 'validation' | 'train', name: BenchmarkName): Promise<Benchmark> {
    const book = new BookBuilder();
    const titles: string[] = [];
    /** Absolute offset of every sentence, by paragraph title. */
    const sentenceStarts = new Map<string, number[]>();
    const questions: BenchmarkQuestion[] = [];

    for (let offset = 0; book.size < HOTPOT_TARGET_CHARS; offset += 100) {
        const page = await cachedJson(
            `${ROWS_API}?dataset=hotpotqa/hotpot_qa&config=distractor&split=${split}&offset=${offset}&length=100`,
            `hotpot-${split}-${offset}.json`
        );
        if (!page.rows?.length) break;

        for (const { row } of page.rows) {
            if (book.size >= HOTPOT_TARGET_CHARS) break;

            // The question's ten paragraphs (two gold, eight retrieved distractors), each once per book.
            row.context.title.forEach((title: string, p: number) => {
                if (sentenceStarts.has(title)) return;
                titles.push(title);
                book.append(title);
                const sentences: string[] = row.context.sentences[p];
                const paragraphStart = book.append(sentences.join(''));
                const starts: number[] = [];
                let cursor = paragraphStart;
                for (const s of sentences) {
                    starts.push(cursor);
                    cursor += s.length;
                }
                sentenceStarts.set(title, starts);
            });

            const spans: Array<{ text: string; start: number }> = [];
            const groupByTitle = new Map<string, number[]>();
            row.supporting_facts.title.forEach((title: string, i: number) => {
                const sentId = row.supporting_facts.sent_id[i];
                const p = row.context.title.indexOf(title);
                const sentence: string | undefined = row.context.sentences[p]?.[sentId];
                const starts = sentenceStarts.get(title);
                if (!sentence || !starts) return; // a few annotations point past the paragraph
                const lead = sentence.length - sentence.trimStart().length;
                spans.push({ text: sentence.trim(), start: starts[sentId] + lead });
                if (!groupByTitle.has(title)) groupByTitle.set(title, []);
                groupByTitle.get(title)!.push(spans.length - 1);
            });
            if (spans.length === 0) continue;

            questions.push({
                id: row.id,
                question: row.question,
                isImpossible: false,
                spans,
                supportGroups: [...groupByTitle.values()],
                answers: [row.answer],
                type: row.type,
            });
        }
    }

    return { name, language: 'en', source: `HotpotQA distractor ${split}`, titles, document: book.build(), questions };
}

// -------------------------------------------------------------------- main

function check(b: Benchmark) {
    for (const q of b.questions) {
        for (const s of q.spans) {
            if (b.document.slice(s.start, s.start + s.text.length) !== s.text) throw new Error(`${b.name}: offset mismatch for ${q.id}: "${s.text}"`);
        }
    }
}

async function main() {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const books = [
        await buildViquad('validation', 'viquad-test'),
        await buildViquad('train', 'viquad-dev'),
        await buildHotpot('validation', 'hotpot-test'),
        await buildHotpot('train', 'hotpot-dev'),
    ];
    for (const b of books) {
        check(b);
        fs.writeFileSync(path.join(DATA_DIR, `${b.name}.json`), JSON.stringify(b, null, 2));
        const answerable = b.questions.filter((q) => !q.isImpossible).length;
        console.log(
            `${b.name}: ${b.source}, ${b.titles.length} titles, ${b.document.length} chars, ` +
                `${b.questions.length} questions (${answerable} answerable, ${b.questions.length - answerable} unanswerable)`
        );
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
