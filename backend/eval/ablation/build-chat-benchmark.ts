/**
 * Builds the "KG-Chat" benchmark: conversations with annotated knowledge-graph
 * entities and relations, to test that the graph learns new entities from a
 * chat and attaches them to what it already holds.
 *
 * Source: OpenDialKG (Moon et al., "OpenDialKG: Explainable Conversational
 * Reasoning with Attention-based Walks over Knowledge Graphs", ACL 2019),
 * CC BY-NC 4.0. In each dialogue the annotators recorded, turn by turn, the
 * knowledge-graph path the conversation follows: triples such as
 * (Iron Man, starred_actors, Robert Downey Jr.). Those triples are the gold
 * standard; only entities actually said in the dialogue count (an entity of
 * the path that nobody mentions cannot be extracted from the text).
 *
 * Dialogues are taken in file order and kept if at least 3 annotated entities
 * and 2 annotated triples are verbalised; the first 40 are used.
 *
 * Usage: npx ts-node eval/ablation/build-chat-benchmark.ts
 * Output (committed): eval/datasets/kg-chat/dialogues.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { containsPhrase, normalizeText } from '../../src/retrieval/text';

const SOURCE_URL = 'https://raw.githubusercontent.com/facebookresearch/opendialkg/main/data/opendialkg.csv';
const RAW = path.join(__dirname, 'data', 'raw', 'opendialkg.csv');
const OUT_DIR = path.join(__dirname, '..', 'datasets', 'kg-chat');
const DIALOGUES = 40;

export interface ChatDialogue {
    id: string;
    /** Row number in opendialkg.csv (1-based, header excluded). */
    sourceRow: number;
    turns: Array<{ sender: 'user' | 'assistant'; text: string }>;
    /** Annotated entities that occur in the dialogue text. */
    entities: string[];
    /** Annotated triples whose two entities both occur in the text (inverse relations "~r" are flipped). */
    triples: Array<{ subject: string; relation: string; object: string }>;
}

/** Minimal RFC 4180 CSV reader (quoted fields, "" escapes, newlines inside quotes). */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else field += ch;
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/** An entity counts as said if its name, or its name without a "(…)" qualifier, occurs as whole words. */
export function mentioned(entity: string, normText: string): boolean {
    const full = normalizeText(entity).trim();
    const bare = normalizeText(entity.replace(/\s*\(.*\)\s*$/, '')).trim();
    return [full, bare].some((n) => n.length >= 3 && containsPhrase(normText, n));
}

async function main() {
    if (!fs.existsSync(RAW)) {
        fs.mkdirSync(path.dirname(RAW), { recursive: true });
        const res = await fetch(SOURCE_URL);
        if (!res.ok) throw new Error(`GET ${SOURCE_URL} -> HTTP ${res.status}`);
        fs.writeFileSync(RAW, await res.text());
    }
    const rows = parseCsv(fs.readFileSync(RAW, 'utf-8')).slice(1);

    const out: ChatDialogue[] = [];
    for (const [r, row] of rows.entries()) {
        if (out.length === DIALOGUES) break;
        let messages: any[];
        try {
            messages = JSON.parse(row[0]);
        } catch {
            continue;
        }
        const turns = messages
            .filter((m) => m.type === 'chat' && typeof m.message === 'string' && m.message.trim())
            .map((m) => ({ sender: m.sender === 'user' ? ('user' as const) : ('assistant' as const), text: m.message.trim() }));
        const normText = normalizeText(turns.map((t) => t.text).join('\n'));

        const triples = new Map<string, { subject: string; relation: string; object: string }>();
        for (const m of messages) {
            const steps = m?.metadata?.path?.[1];
            if (!Array.isArray(steps)) continue;
            for (const [s, rel, o] of steps) {
                if (typeof s !== 'string' || typeof rel !== 'string' || typeof o !== 'string') continue;
                const t = rel.startsWith('~') ? { subject: o, relation: rel.slice(1), object: s } : { subject: s, relation: rel, object: o };
                triples.set(`${t.subject}|${t.relation}|${t.object}`, t);
            }
        }
        const said = [...triples.values()].filter((t) => mentioned(t.subject, normText) && mentioned(t.object, normText));
        const entities = [...new Set([...triples.values()].flatMap((t) => [t.subject, t.object]).filter((e) => mentioned(e, normText)))];
        if (entities.length < 3 || said.length < 2) continue;

        out.push({ id: `KGC-${String(out.length + 1).padStart(2, '0')}`, sourceRow: r + 1, turns, entities, triples: said });
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'dialogues.json'), JSON.stringify(out, null, 2));
    const e = out.reduce((s, d) => s + d.entities.length, 0);
    const t = out.reduce((s, d) => s + d.triples.length, 0);
    const turns = out.reduce((s, d) => s + d.turns.length, 0);
    console.log(`${out.length} dialogues (rows ${out[0].sourceRow}-${out[out.length - 1].sourceRow}), ${turns} turns, ${e} annotated entities, ${t} annotated triples`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
