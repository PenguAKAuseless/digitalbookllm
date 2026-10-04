/**
 * Builds the "KG-Series" benchmark: a three-volume book series whose later
 * volumes ask questions that can only be answered from an earlier volume.
 * It measures what a personal knowledge graph is for — linking what the
 * user reads now to what they read before.
 *
 * Source: HotpotQA, distractor setting, validation split (Yang et al.,
 * EMNLP 2018; CC BY-SA 4.0). Only *bridge* questions are used: each has two
 * annotated evidence paragraphs, a "bridge" paragraph about the entity the
 * question names, which mentions a second entity, and an "answer" paragraph
 * about that second entity, which holds the answer. Questions are taken in
 * dataset order; a question is kept only if
 *
 *   - it has exactly two evidence paragraphs,
 *   - the answer occurs in one of them (the answer paragraph) and not in the other,
 *   - the bridge paragraph names the answer paragraph's subject (so the link exists in the text),
 *   - none of its paragraphs was already used by an earlier kept question,
 *   - once the volumes are assembled, the answer string occurs nowhere in the
 *     volume the question is asked in (otherwise it is dropped and the next
 *     question in dataset order takes its place).
 *
 * Kept questions alternate between group A and group B:
 *
 *   Volume 1  answer paragraphs of A (+2 of each question's distractors)
 *   Volume 2  bridge paragraphs of A (+2 distractors) and answer paragraphs of B (+2 distractors)
 *   Volume 3  bridge paragraphs of B (+2 distractors)
 *
 * A questions are asked while reading volume 2, B questions while reading
 * volume 3, with only the volumes read so far in the workspace. The answer
 * is always in the previous volume and never in the one being read.
 *
 * Usage: npx ts-node eval/ablation/build-series.ts
 * Output (committed): eval/datasets/kg-series/{volume-1.txt, volume-2.txt, volume-3.txt, questions.json, README.md}
 */
import * as fs from 'fs';
import * as path from 'path';

/** SPLIT=train builds the development copy (parameter tuning only), kept out of the repository. */
const SPLIT = process.env.SPLIT === 'train' ? 'train' : 'validation';
const OUT_DIR = SPLIT === 'train' ? path.join(__dirname, 'data', 'kg-series-dev') : path.join(__dirname, '..', 'datasets', 'kg-series');
const RAW_DIR = path.join(__dirname, 'data', 'raw');
const ROWS_API = `https://datasets-server.huggingface.co/rows?dataset=hotpotqa/hotpot_qa&config=distractor&split=${SPLIT}`;
const QUESTIONS = 40;
const DISTRACTORS_PER_SIDE = 2;

export interface SeriesSpan {
    volume: number;
    /** Character offset into that volume's text. */
    start: number;
    text: string;
}

export interface SeriesQuestion {
    id: string;
    hotpotId: string;
    question: string;
    answer: string;
    group: 'A' | 'B';
    /** Volume the user is reading when asking; volumes 1..askedIn are in the workspace. */
    askedIn: number;
    answerVolume: number;
    bridgeTitle: string;
    answerTitle: string;
    /** Annotated supporting sentences, grouped by paragraph: [bridge, answer]. */
    support: { bridge: SeriesSpan[]; answer: SeriesSpan[] };
}

export interface Series {
    volumes: Array<{ number: number; title: string; text: string }>;
    questions: SeriesQuestion[];
}

async function cachedJson(url: string, file: string): Promise<any> {
    const target = path.join(RAW_DIR, file);
    if (fs.existsSync(target)) return JSON.parse(fs.readFileSync(target, 'utf-8'));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(target, text);
    return JSON.parse(text);
}

const lower = (s: string) => s.toLowerCase();
const subjectOf = (title: string) => title.replace(/\s*\(.*\)\s*$/, '');

interface Paragraph {
    title: string;
    sentences: string[];
}

interface Picked {
    row: any;
    bridge: Paragraph;
    answer: Paragraph;
    bridgeSentIds: number[];
    answerSentIds: number[];
    distractors: Paragraph[];
}

function pick(row: any, used: Set<string>): Picked | null {
    if (row.type !== 'bridge') return null;
    const titles: string[] = [...new Set<string>(row.supporting_facts.title)];
    if (titles.length !== 2) return null;
    const para = (title: string): Paragraph => ({ title, sentences: row.context.sentences[row.context.title.indexOf(title)] ?? [] });
    const [p, q] = titles.map(para);
    const has = (x: Paragraph) => lower(x.sentences.join('')).includes(lower(row.answer));
    if (has(p) === has(q)) return null;
    const answer = has(p) ? p : q;
    const bridge = has(p) ? q : p;
    if (!lower(bridge.sentences.join('')).includes(lower(subjectOf(answer.title)))) return null;

    const distractors = (row.context.title as string[])
        .filter((t) => !titles.includes(t))
        .map(para)
        .filter((d) => d.sentences.length > 0);
    const all = [bridge, answer, ...distractors.slice(0, 2 * DISTRACTORS_PER_SIDE)];
    if (distractors.length < 2 * DISTRACTORS_PER_SIDE || all.some((x) => used.has(x.title))) return null;

    const sentIds = (title: string) =>
        row.supporting_facts.title.flatMap((t: string, i: number) => (t === title ? [row.supporting_facts.sent_id[i]] : []));
    return { row, bridge, answer, bridgeSentIds: sentIds(bridge.title), answerSentIds: sentIds(answer.title), distractors: distractors.slice(0, 2 * DISTRACTORS_PER_SIDE) };
}

/** Accumulates one volume's text; returns each sentence's offset. */
class Volume {
    private parts: string[] = [];
    private length = 0;

    constructor(readonly number: number, readonly title: string) {
        this.append(title);
    }

    private append(text: string): number {
        if (this.parts.length > 0) this.length += 2;
        const start = this.length;
        this.parts.push(text);
        this.length += text.length;
        return start;
    }

    /** Adds a titled section; returns the absolute offset of every sentence (leading space excluded). */
    addSection(p: Paragraph): number[] {
        this.append(p.title);
        const start = this.append(p.sentences.join('').trim());
        const offsets: number[] = [];
        let cursor = start - (p.sentences.join('').length - p.sentences.join('').trimStart().length);
        for (const s of p.sentences) {
            offsets.push(cursor + (s.length - s.trimStart().length));
            cursor += s.length;
        }
        return offsets;
    }

    get text(): string {
        return this.parts.join('\n\n');
    }
}

async function selectQuestions(excluded: Set<string>): Promise<{ picked: Picked[]; scanned: number }> {
    const used = new Set<string>();
    const picked: Picked[] = [];
    let scanned = 0;
    for (let offset = 0; picked.length < QUESTIONS; offset += 100) {
        const page = await cachedJson(`${ROWS_API}&offset=${offset}&length=100`, `hotpot-${SPLIT}-${offset}.json`);
        if (!page.rows?.length) break;
        for (const { row } of page.rows) {
            scanned++;
            if (excluded.has(row.id)) continue;
            const p = pick(row, used);
            if (!p) continue;
            for (const x of [p.bridge, p.answer, ...p.distractors]) used.add(x.title);
            picked.push(p);
            if (picked.length === QUESTIONS) break;
        }
    }
    return { picked, scanned };
}

async function main() {
    const excluded = new Set<string>();
    for (let round = 1; ; round++) {
        const { picked, scanned } = await selectQuestions(excluded);
        const series = assemble(picked);
        const leaking = series.questions.filter((q) =>
            series.volumes[q.askedIn - 1].text.toLowerCase().includes(q.answer.toLowerCase())
        );
        if (leaking.length === 0) return write(series, scanned, excluded.size);
        for (const q of leaking) excluded.add(q.hotpotId);
        if (round > 20) throw new Error('could not find enough leak-free questions');
    }
}

function assemble(picked: Picked[]): Series {
    const volumes = [1, 2, 3].map((n) => new Volume(n, `KG-Series, Volume ${n}`));
    const questions: SeriesQuestion[] = [];

    picked.forEach((p, i) => {
        const group = i % 2 === 0 ? 'A' : 'B';
        const answerVolume = group === 'A' ? 1 : 2;
        const askedIn = answerVolume + 1;
        const answerVol = volumes[answerVolume - 1];
        const askedVol = volumes[askedIn - 1];

        const answerOffsets = answerVol.addSection(p.answer);
        p.distractors.slice(0, DISTRACTORS_PER_SIDE).forEach((d) => answerVol.addSection(d));
        const bridgeOffsets = askedVol.addSection(p.bridge);
        p.distractors.slice(DISTRACTORS_PER_SIDE).forEach((d) => askedVol.addSection(d));

        const spans = (para: Paragraph, offsets: number[], ids: number[], volume: number): SeriesSpan[] =>
            ids.filter((id) => para.sentences[id]).map((id) => ({ volume, start: offsets[id], text: para.sentences[id].trim() }));

        questions.push({
            id: `KGS-${String(i + 1).padStart(2, '0')}`,
            hotpotId: p.row.id,
            question: p.row.question,
            answer: p.row.answer,
            group,
            askedIn,
            answerVolume,
            bridgeTitle: p.bridge.title,
            answerTitle: p.answer.title,
            support: {
                bridge: spans(p.bridge, bridgeOffsets, p.bridgeSentIds, askedIn),
                answer: spans(p.answer, answerOffsets, p.answerSentIds, answerVolume),
            },
        });
    });

    return { volumes: volumes.map((v) => ({ number: v.number, title: v.title, text: v.text })), questions };
}

function write(series: Series, scanned: number, droppedForLeak: number) {
    const { questions } = series;

    // Every span must sit exactly at its offset, and no answer may appear in the volume it is asked in.
    for (const q of questions) {
        for (const s of [...q.support.bridge, ...q.support.answer]) {
            const text = series.volumes[s.volume - 1].text;
            if (text.slice(s.start, s.start + s.text.length) !== s.text) throw new Error(`${q.id}: offset mismatch for "${s.text}"`);
        }
        const asked = series.volumes[q.askedIn - 1].text.toLowerCase();
        const answerSection = asked.indexOf(q.bridgeTitle.toLowerCase());
        if (answerSection === -1) throw new Error(`${q.id}: bridge section missing`);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const v of series.volumes) fs.writeFileSync(path.join(OUT_DIR, `volume-${v.number}.txt`), v.text);
    fs.writeFileSync(path.join(OUT_DIR, 'questions.json'), JSON.stringify(questions, null, 2));
    console.log(`scanned ${scanned} ${SPLIT} questions, kept ${questions.length} (dropped ${droppedForLeak} whose answer also occurs in the volume being read)`);
    for (const v of series.volumes) {
        const sections = (v.text.match(/\n\n/g)?.length ?? 0) / 2;
        console.log(`volume ${v.number}: ${v.text.length} chars, ~${Math.round(sections)} sections`);
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
