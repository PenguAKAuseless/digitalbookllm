import { v4 as uuid } from 'uuid';
import { pool } from '../../db/config';
import { llmRouter, LLMUnavailableError } from '../../llm/router';
import { enqueue, Job } from '../jobQueue';

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
 * Sized for Groq's free tier: 8K tokens per minute per model, counting the
 * prompt plus max_tokens. ~8000 chars (~2.5-3.5K tokens, Vietnamese costs
 * more) + instructions + 2000 output stays near 6K, so each request fits on
 * its own and a document costs at most GRAPH_MAX_CALLS requests (~25K of the
 * 200K daily tokens).
 */
const WINDOW_CHARS = parseInt(process.env.GRAPH_WINDOW_CHARS || '8000');
const MAX_CALLS = parseInt(process.env.GRAPH_MAX_CALLS || '4');
const OUTPUT_TOKENS = parseInt(process.env.GRAPH_OUTPUT_TOKENS || '2000');
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

    const windows = sampleWindows(splitIntoWindows(sourceText, WINDOW_CHARS), MAX_CALLS);
    const idByName = new Map<string, string>();
    const errors: string[] = [];
    let succeeded = 0;
    let consecutiveFailures = 0;
    let entityCount = 0;
    let relationCount = 0;

    for (const window of windows) {
        let extracted: { entities: ExtractedEntity[]; relations: ExtractedRelation[] };
        try {
            extracted = await extractWithRateLimitWait(window, [...idByName.keys()].slice(-KNOWN_NAMES_HINT));
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

            const excerpt = (relation.evidence?.trim() || window.slice(0, 300)).slice(0, 500);
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
async function resolveEntity(userId: string, idByName: Map<string, string>, entity: ExtractedEntity): Promise<string> {
    const name = cleanName(entity.name);
    const key = name.toLowerCase();
    const known = idByName.get(key);
    if (known && !entity.description) return known;

    const { rows } = await pool.query(
        `INSERT INTO entities (id, user_id, name, type, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, name)
         DO UPDATE SET description = COALESCE(NULLIF(EXCLUDED.description, ''), entities.description), updated_at = NOW()
         RETURNING id`,
        [uuid(), userId, name, (cleanName(entity.type) || 'concept').toLowerCase().slice(0, 100), entity.description?.trim() || '']
    );
    idByName.set(key, rows[0].id);
    return rows[0].id;
}

/** Inserts the edge unless the same relation already exists; re-running extraction must not duplicate edges. */
async function insertRelation(
    userId: string,
    sourceId: string,
    targetId: string,
    type: string,
    documentId: string | undefined,
    excerpt: string
): Promise<boolean> {
    const relationType = (cleanName(type) || 'related_to').slice(0, 100);
    const { rowCount } = await pool.query(
        `INSERT INTO entity_relations (id, user_id, source_entity_id, target_entity_id, relation_type, source_document_id, excerpt)
         SELECT $1, $2, $3, $4, $5, $6, $7
         WHERE NOT EXISTS (
             SELECT 1 FROM entity_relations
             WHERE user_id = $2 AND source_entity_id = $3 AND target_entity_id = $4 AND relation_type = $5
               AND source_document_id IS NOT DISTINCT FROM $6
         )`,
        [uuid(), userId, sourceId, targetId, relationType, documentId ?? null, excerpt]
    );
    return Boolean(rowCount);
}

/**
 * Free tiers also cap tokens per minute, so back-to-back windows can be
 * throttled. When the provider says how long to wait, and it is short, wait
 * and send the same window again rather than losing it.
 */
async function extractWithRateLimitWait(text: string, knownNames: string[]) {
    try {
        return await extractWithLLM(text, knownNames);
    } catch (err) {
        const wait = err instanceof LLMUnavailableError ? err.retryAfterMs : undefined;
        if (wait === undefined || wait > MAX_RATE_LIMIT_WAIT_MS) throw err;
        console.log(`[graph] rate limited, waiting ${Math.ceil(wait / 1000)}s before retrying the window`);
        await sleep(wait + 500);
        return extractWithLLM(text, knownNames);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractWithLLM(
    text: string,
    knownNames: string[]
): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
    const system =
        'You build a knowledge graph from a passage of a book or a conversation about it. ' +
        'Extract the key entities (people, organisations, places, concepts, methods, technologies, events) ' +
        'and the relationships between them that the text actually states. ' +
        'Write names, types and descriptions in the same language as the text. ' +
        'Respond with ONLY a JSON object of the shape ' +
        '{"entities":[{"name":string,"type":string,"description":string}],' +
        '"relations":[{"source":string,"target":string,"type":string,"evidence":string}]}. ' +
        'type is one short lowercase word or phrase; description is at most 20 words; ' +
        'relation type is a short verb phrase such as "is part of" or "influenced"; ' +
        'evidence is a quote of at most 15 words from the text supporting the relation. ' +
        'Every relation source and target must be the exact name of an entity in the list. ' +
        'Return at most 15 entities and 20 relations. No prose or markdown outside the JSON.' +
        (knownNames.length > 0
            ? ` Entities already in the graph (reuse these exact names when the text refers to them): ${knownNames.join('; ')}.`
            : '');

    const { text: raw, provider } = await llmRouter.generate(
        [
            { role: 'system', content: system },
            { role: 'user', content: text },
        ],
        { maxTokens: OUTPUT_TOKENS, temperature: 0.2, json: true }
    );

    const parsed = parseJsonObject(raw);
    if (!parsed) throw new Error(`${provider} returned unparseable JSON: ${raw.slice(0, 200)}`);
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
