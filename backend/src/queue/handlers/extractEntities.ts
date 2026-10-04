import { v4 as uuid } from 'uuid';
import { pool } from '../../db/config';
import { llmRouter, LLMUnavailableError } from '../../llm/router';
import { enqueue, Job } from '../jobQueue';
import { containsPhrase, normalizeText } from '../../retrieval/text';

interface ExtractPayload {
    userId: string;
    documentId?: string;
    /** Chat text to mine when growing the graph from a live conversation (FR06). */
    text?: string;
}

interface ExtractedEntity {
    name: string;
    type: string;
    description: string;
}

interface ExtractedRelation {
    source: string;
    target: string;
    type: string;
    evidence?: string;
}

/*
 * The graph feeds retrieval (src/retrieval/graphSignals.ts), so it should
 * cover the whole book, not a sample. Sized for Groq's free tier (8K tokens
 * per minute per model, prompt + max_tokens): ~6000 chars (~2-2.5K tokens)
 * + instructions + 2500 output stays near 5.5K per request. A book of
 * ~120K characters is covered in full by GRAPH_MAX_CALLS = 20 requests
 * (~100K of the 200K daily tokens); longer books are sampled evenly.
 */
const WINDOW_CHARS = parseInt(process.env.GRAPH_WINDOW_CHARS || '6000');
const MAX_CALLS = parseInt(process.env.GRAPH_MAX_CALLS || '20');
const OUTPUT_TOKENS = parseInt(process.env.GRAPH_OUTPUT_TOKENS || '2500');
/** Consecutive chat turns are merged into one pending job, sent once the conversation pauses. */
const CHAT_DEBOUNCE_SECONDS = parseInt(process.env.GRAPH_CHAT_DEBOUNCE_SECONDS || '120');
/** Stop spending requests on a job once the providers are clearly unavailable (e.g. rate limited). */
const MAX_CONSECUTIVE_FAILURES = 2;
/** Longest rate-limit wait honoured inside a job; anything longer (e.g. a daily cap) fails the window instead. */
const MAX_RATE_LIMIT_WAIT_MS = 65_000;
/** Names already in the graph are fed back so later windows reuse them instead of inventing variants. */
const KNOWN_NAMES_HINT = 40;

/**
 * Worker 2 (Knowledge Extraction): reads chat/document text, asks the LLM
 * router for entities and relations, and merges them into the user's
 * evolving knowledge graph (FR06, UC15). Runs entirely in the background —
 * failures here never affect the reading or chat experience.
 */
export async function handleExtractEntities(job: Job): Promise<void> {
    const { userId, documentId, text } = job.payload as unknown as ExtractPayload;

    const sourceText = text ?? (await loadDocumentText(documentId));
    if (!sourceText || sourceText.trim().length < 40) return; // not enough signal to extract from

    const windows = extractionWindows(sourceText);
    // Entities the user's graph already holds and this text names: their ids are reused and their
    // exact names are offered to the model, so new knowledge attaches to the existing graph.
    const idByName = await knownEntitiesIn(userId, sourceText);
    const errors: string[] = [];
    let succeeded = 0;
    let consecutiveFailures = 0;
    let entityCount = 0;
    let relationCount = 0;

    for (const window of windows) {
        let extracted: { entities: ExtractedEntity[]; relations: ExtractedRelation[] };
        try {
            extracted = await extractWindowGraph(window, knownNamesFor(window, idByName));
        } catch (err: any) {
            errors.push(err?.message || String(err));
            if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
            continue;
        }
        consecutiveFailures = 0;
        succeeded++;

        for (const entity of extracted.entities) {
            if (!cleanName(entity.name)) continue;
            await resolveEntity(userId, idByName, entity);
            entityCount++;
        }

        for (const relation of extracted.relations) {
            if (!cleanName(relation.source) || !cleanName(relation.target)) continue;
            // An endpoint the model named without listing it still becomes a node.
            const sourceId = await resolveEntity(userId, idByName, { name: relation.source, type: 'concept', description: '' });
            const targetId = await resolveEntity(userId, idByName, { name: relation.target, type: 'concept', description: '' });
            if (sourceId === targetId) continue;

            const excerpt = groundEvidence(relation.evidence, window, relation.source, relation.target);
            const inserted = await insertRelation(userId, sourceId, targetId, relation.type, documentId, excerpt);
            if (inserted) relationCount++;
        }
    }

    const label = documentId ? `document ${documentId}` : `user ${userId}`;
    console.log(
        `[graph] ${label}: ${succeeded}/${windows.length} windows ok, ${entityCount} entities, ${relationCount} new relations`
    );
    // Retry the job only when nothing got through; a partial graph is kept as is.
    if (succeeded === 0) throw new Error(`Knowledge extraction failed: ${errors.join(' | ')}`);
    if (errors.length > 0) console.warn(`[graph] ${label}: ${errors.length} window(s) failed: ${errors.join(' | ')}`);
}

/**
 * Queues graph extraction for one chat exchange. Rather than one LLM request
 * per message, the text is appended to the user's pending chat job if there
 * is one, so a whole conversation burst costs a single request.
 */
export async function enqueueChatExtraction(userId: string, documentId: string | undefined, text: string): Promise<void> {
    const { rowCount } = await pool.query(
        `UPDATE jobs
         SET payload = jsonb_set(payload, '{text}', to_jsonb((payload->>'text') || E'\\n\\n' || $3::text)), updated_at = NOW()
         WHERE type = 'EXTRACT_ENTITIES' AND status = 'PENDING'
           AND payload->>'userId' = $1 AND payload ? 'text'
           AND COALESCE(payload->>'documentId', '') = COALESCE($2::text, '')`,
        [userId, documentId ?? null, text]
    );
    if (rowCount && rowCount > 0) return;
    await enqueue('EXTRACT_ENTITIES', { userId, documentId, text }, new Date(Date.now() + CHAT_DEBOUNCE_SECONDS * 1000));
}

async function loadDocumentText(documentId?: string): Promise<string> {
    if (!documentId) return '';
    const { rows } = await pool.query('SELECT full_text FROM documents WHERE id = $1', [documentId]);
    return rows[0]?.full_text ?? '';
}

/** Cuts text into windows of at most `size` chars, preferring paragraph then sentence boundaries. */
export function splitIntoWindows(text: string, size: number): string[] {
    const windows: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + size, text.length);
        if (end < text.length) {
            const floor = start + Math.floor(size * 0.7);
            const paragraph = text.lastIndexOf('\n\n', end);
            const sentence = text.lastIndexOf('. ', end);
            if (paragraph > floor) end = paragraph;
            else if (sentence > floor) end = sentence + 1;
        }
        const window = text.slice(start, end).trim();
        if (window.length >= 40) windows.push(window);
        start = end;
    }
    return windows;
}

const MAX_EXCERPT_CHARS = 400;

/** One-to-one character folding (case, dash and quote variants), so indices in the folded text match the original. */
function fold(text: string): string {
    return text.toLowerCase().replace(/[‐‑‒–—―]/g, '-').replace(/[“”„«»]/g, '"').replace(/[‘’‚`]/g, "'");
}

/**
 * Turns the model's evidence into a real quotation of the source. Models
 * often paraphrase, elide ("...") or stitch quotes together, which would make
 * the graph's citations unverifiable. The evidence is kept only if it occurs
 * verbatim in the window; otherwise the window's sentence that names both
 * endpoints (or failing that, one of them and most of the evidence's words)
 * is quoted instead. Returns null when nothing in the window supports it.
 */
export function groundEvidence(evidence: unknown, window: string, source: string, target: string): string | null {
    const text = window.replace(/\s+/g, ' ');
    const folded = fold(text);
    const quote = typeof evidence === 'string' ? fold(evidence.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '')) : '';

    if (quote.length >= 8 && !quote.includes('...') && !quote.includes('…')) {
        const at = folded.indexOf(quote);
        if (at !== -1) return text.slice(at, at + quote.length).slice(0, MAX_EXCERPT_CHARS);
    }

    const sentences: Array<{ start: number; end: number }> = [];
    const boundary = /[.!?…](?=\s|$)/g;
    let start = 0;
    for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
        sentences.push({ start, end: m.index + 1 });
        start = m.index + 1;
    }
    if (start < text.length) sentences.push({ start, end: text.length });

    const s = fold(source.trim());
    const t = fold(target.trim());
    const quoteWords = new Set(quote.match(/[\p{L}\p{N}]+/gu) ?? []);
    let best: { score: number; start: number; end: number } | null = null;
    for (const sentence of sentences) {
        const f = folded.slice(sentence.start, sentence.end);
        const hasS = s.length > 0 && f.includes(s);
        const hasT = t.length > 0 && f.includes(t);
        if (!hasS && !hasT) continue;
        const words = f.match(/[\p{L}\p{N}]+/gu) ?? [];
        const overlap = quoteWords.size ? words.filter((w) => quoteWords.has(w)).length / quoteWords.size : 0;
        const score = (hasS && hasT ? 2 : 0) + overlap;
        if (!best || score > best.score) best = { score, ...sentence };
    }
    return best ? text.slice(best.start, best.end).trim().slice(0, MAX_EXCERPT_CHARS) : null;
}

/** The windows one extraction job sends to the LLM, within the per-document request budget. */
export function extractionWindows(text: string): string[] {
    return sampleWindows(splitIntoWindows(text, WINDOW_CHARS), MAX_CALLS);
}

/** Spreads the request budget evenly across the whole book instead of spending it all on chapter one. */
export function sampleWindows(windows: string[], max: number): string[] {
    if (windows.length <= max) return windows;
    const step = windows.length / max;
    return Array.from({ length: max }, (_, i) => windows[Math.floor(i * step)]);
}

function cleanName(name: unknown): string {
    return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

/** Returns the entity's id, creating or enriching it on first sight within this job. */
type KnownEntities = Map<string, { id: string; name: string }>;

/** The user's existing entities whose name occurs in `text` (case-insensitive, whole words), keyed by lower-cased name. */
async function knownEntitiesIn(userId: string, text: string): Promise<KnownEntities> {
    const { rows } = await pool.query(`SELECT id, name FROM entities WHERE user_id = $1`, [userId]);
    const haystack = normalizeText(text);
    const known: KnownEntities = new Map();
    for (const row of rows as Array<{ id: string; name: string }>) {
        const name = normalizeText(row.name).trim();
        if (name.length >= 3 && containsPhrase(haystack, name)) known.set(row.name.toLowerCase(), { id: row.id, name: row.name });
    }
    return known;
}

/** Names to offer the model for one window: known entities it mentions first, then the latest ones of this job. */
function knownNamesFor(window: string, known: KnownEntities): string[] {
    const haystack = normalizeText(window);
    const all = [...known.values()];
    const mentioned = all.filter((e) => containsPhrase(haystack, normalizeText(e.name).trim()));
    const rest = all.filter((e) => !mentioned.includes(e)).slice(-KNOWN_NAMES_HINT);
    return [...new Set([...mentioned, ...rest].map((e) => e.name))].slice(0, KNOWN_NAMES_HINT);
}

/**
 * Returns the entity's id, reusing an existing entity of the same name in any
 * letter case (an entity first met in a book and later in a chat must stay
 * one node), creating it otherwise.
 */
async function resolveEntity(userId: string, idByName: KnownEntities, entity: ExtractedEntity): Promise<string> {
    const name = cleanName(entity.name);
    const key = name.toLowerCase();
    const known = idByName.get(key);
    if (known && !entity.description) return known.id;

    if (!known) {
        const existing = await pool.query(`SELECT id, name FROM entities WHERE user_id = $1 AND lower(name) = lower($2) LIMIT 1`, [userId, name]);
        if (existing.rows.length > 0) {
            const row = existing.rows[0];
            if (entity.description?.trim()) {
                await pool.query(
                    `UPDATE entities SET description = COALESCE(NULLIF(description, ''), $2), updated_at = NOW() WHERE id = $1`,
                    [row.id, entity.description.trim()]
                );
            }
            idByName.set(key, { id: row.id, name: row.name });
            return row.id;
        }
    }

    const { rows } = await pool.query(
        `INSERT INTO entities (id, user_id, name, type, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, name)
         DO UPDATE SET description = COALESCE(NULLIF(EXCLUDED.description, ''), entities.description), updated_at = NOW()
         RETURNING id`,
        [uuid(), userId, known?.name ?? name, (cleanName(entity.type) || 'concept').toLowerCase().slice(0, 100), entity.description?.trim() || '']
    );
    idByName.set(key, { id: rows[0].id, name });
    return rows[0].id;
}

/** Inserts the edge unless the same relation already exists; re-running extraction must not duplicate edges. */
async function insertRelation(
    userId: string,
    sourceId: string,
    targetId: string,
    type: string,
    documentId: string | undefined,
    excerpt: string | null
): Promise<boolean> {
    const relationType = (cleanName(type) || 'related_to').slice(0, 100);
    const { rowCount } = await pool.query(
        `INSERT INTO entity_relations (id, user_id, source_entity_id, target_entity_id, relation_type, source_document_id, excerpt)
         SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text
         WHERE NOT EXISTS (
             SELECT 1 FROM entity_relations
             WHERE user_id = $2::text AND source_entity_id = $3::text AND target_entity_id = $4::text AND relation_type = $5::text
               AND source_document_id IS NOT DISTINCT FROM $6::text
         )`,
        [uuid(), userId, sourceId, targetId, relationType, documentId ?? null, excerpt]
    );
    return Boolean(rowCount);
}

/**
 * Sends one window, retrying it once instead of losing its part of the graph when:
 *  - the provider is rate limited and says the wait is short (free tiers cap tokens per minute);
 *  - the reply is not usable JSON, or the model fell into a repetition loop. Both are
 *    sampling failures, so the retry samples a little more freely and restates the format.
 */
export async function extractWindowGraph(
    text: string,
    knownNames: string[]
): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
    try {
        return await extractWithLLM(text, knownNames);
    } catch (err: any) {
        const wait = err instanceof LLMUnavailableError ? err.retryAfterMs : undefined;
        if (wait !== undefined && wait <= MAX_RATE_LIMIT_WAIT_MS) {
            console.log(`[graph] rate limited, waiting ${Math.ceil(wait / 1000)}s before retrying the window`);
            await sleep(wait + 500);
            return extractWithLLM(text, knownNames);
        }
        if (err instanceof UnusableOutputError || REPETITION_LOOP.test(err?.message ?? '')) {
            console.log(`[graph] unusable model output, retrying the window: ${String(err?.message).slice(0, 120)}`);
            return extractWithLLM(text, knownNames, RETRY_SAMPLING);
        }
        throw err;
    }
}

/** The reply arrived but could not be parsed into the expected JSON object. */
export class UnusableOutputError extends Error {}

/** Ollama aborts a generation stuck repeating the same tokens ("token repeat limit reached"). */
const REPETITION_LOOP = /repeat limit|repetition/i;

const RETRY_SAMPLING = {
    temperature: 0.5,
    reminder: 'Your previous reply was not a valid JSON object. Reply with one complete, valid JSON object and nothing else.',
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractWithLLM(
    text: string,
    knownNames: string[],
    sampling: { temperature: number; reminder?: string } = { temperature: 0.2 }
): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
    const system =
        'You build a knowledge graph from a passage of a book or a conversation about it. ' +
        'Extract the key entities (people, organisations, places, concepts, methods, technologies, events) ' +
        'and the relationships between them that the text actually states. ' +
        'Write each entity name exactly as it appears in the text (same spelling and language, no translation), ' +
        'using the most specific full name; write types and descriptions in the same language as the text. ' +
        'Respond with ONLY a JSON object of the shape ' +
        '{"entities":[{"name":string,"type":string,"description":string}],' +
        '"relations":[{"source":string,"target":string,"type":string,"evidence":string}]}. ' +
        'type is one short lowercase word or phrase; description is at most 20 words; ' +
        'relation type is a short verb phrase such as "is part of" or "influenced"; ' +
        'evidence is a quote of at most 15 words from the text supporting the relation. ' +
        'Every relation source and target must be the exact name of an entity in the list. ' +
        'Return at most 20 entities and 25 relations. No prose or markdown outside the JSON.' +
        (knownNames.length > 0
            ? ` Entities already in the graph (reuse these exact names when the text refers to them): ${knownNames.join('; ')}.`
            : '');

    const { text: raw, provider } = await llmRouter.generate(
        [
            { role: 'system', content: sampling.reminder ? `${system} ${sampling.reminder}` : system },
            { role: 'user', content: text },
        ],
        { maxTokens: OUTPUT_TOKENS, temperature: sampling.temperature, json: true }
    );

    const parsed = parseJsonObject(raw);
    if (!parsed) throw new UnusableOutputError(`${provider} returned unparseable JSON: ${raw.slice(0, 200)}`);
    return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
    };
}

/** Tolerates code fences and prose around the object, which several models add despite instructions. */
export function parseJsonObject(raw: string): any | null {
    const stripped = raw.replace(/```(?:json)?/gi, '');
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(stripped.slice(start, end + 1));
    } catch {
        return null;
    }
}
