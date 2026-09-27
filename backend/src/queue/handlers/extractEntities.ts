import { v4 as uuid } from 'uuid';
import { pool } from '../../db/config';
import { llmRouter } from '../../llm/router';
import { Job } from '../jobQueue';

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
}

const MAX_SOURCE_CHARS = 6000;

/**
 * Worker 2 (Knowledge Extraction): reads chat/document text, asks the LLM
 * router for entities and relations, and merges them into the user's
 * evolving knowledge graph (FR06, UC15). Runs entirely in the background —
 * failures here never affect the reading or chat experience.
 */
export async function handleExtractEntities(job: Job): Promise<void> {
    const { userId, documentId, text } = job.payload as unknown as ExtractPayload;

    const sourceText = text ?? (await loadDocumentExcerpt(documentId));
    if (!sourceText || sourceText.trim().length < 40) return; // not enough signal to extract from

    const { entities, relations } = await extractWithLLM(sourceText.slice(0, MAX_SOURCE_CHARS));
    if (entities.length === 0) return;

    const idByName = new Map<string, string>();

    for (const entity of entities) {
        const id = await upsertEntity(userId, entity);
        idByName.set(entity.name.toLowerCase(), id);
    }

    for (const relation of relations) {
        const sourceId = idByName.get(relation.source.toLowerCase());
        const targetId = idByName.get(relation.target.toLowerCase());
        if (!sourceId || !targetId || sourceId === targetId) continue;

        await pool.query(
            `INSERT INTO entity_relations (id, user_id, source_entity_id, target_entity_id, relation_type, source_document_id, excerpt)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uuid(), userId, sourceId, targetId, relation.type || 'related_to', documentId ?? null, sourceText.slice(0, 300)]
        );
    }
}

async function loadDocumentExcerpt(documentId?: string): Promise<string> {
    if (!documentId) return '';
    const { rows } = await pool.query('SELECT full_text FROM documents WHERE id = $1', [documentId]);
    return rows[0]?.full_text ?? '';
}

async function upsertEntity(userId: string, entity: ExtractedEntity): Promise<string> {
    const { rows } = await pool.query(
        `INSERT INTO entities (id, user_id, name, type, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, name)
         DO UPDATE SET description = COALESCE(NULLIF(EXCLUDED.description, ''), entities.description), updated_at = NOW()
         RETURNING id`,
        [uuid(), userId, entity.name.trim(), entity.type || 'concept', entity.description || '']
    );
    return rows[0].id;
}

async function extractWithLLM(text: string): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
    const { text: raw } = await llmRouter.generate([
        {
            role: 'system',
            content:
                'Extract key entities (people, concepts, technologies) and their relationships from the given text. ' +
                'Respond with ONLY a JSON object of the shape ' +
                '{"entities":[{"name":string,"type":string,"description":string}],' +
                '"relations":[{"source":string,"target":string,"type":string}]}. ' +
                'Keep to at most 10 entities and 15 relations. No prose outside the JSON.',
        },
        { role: 'user', content: text },
    ]);

    try {
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
        return {
            entities: Array.isArray(parsed.entities) ? parsed.entities : [],
            relations: Array.isArray(parsed.relations) ? parsed.relations : [],
        };
    } catch {
        return { entities: [], relations: [] };
    }
}
