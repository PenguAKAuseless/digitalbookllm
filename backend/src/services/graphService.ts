import { pool } from '../db/config';
import { enqueue } from '../queue/jobQueue';

export interface ExtractionStatus {
    /** Latest document-level extraction job, or null if none was ever queued. */
    job: { status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'DEAD'; error: string | null; attempts: number; updated_at: string } | null;
    documentStatus: string;
    relationCount: number;
}

/** Document-level jobs carry no `text`; chat-driven ones do. */
const DOCUMENT_JOB_FILTER = `type = 'EXTRACT_ENTITIES' AND payload->>'documentId' = $1 AND NOT (payload ? 'text')`;

/** Knowledge graph queries (UC15), stored relationally per ADR-04. */
export class GraphService {
    /** The user's whole graph, or only the part extracted from one document. */
    async getGraph(userId: string, documentId?: string) {
        if (documentId) {
            const edges = await pool.query(
                `SELECT r.id, r.source_entity_id AS source, r.target_entity_id AS target, r.relation_type,
                        r.source_document_id, d.title AS source_document_title
                 FROM entity_relations r
                 LEFT JOIN documents d ON d.id = r.source_document_id
                 WHERE r.user_id = $1 AND r.source_document_id = $2
                 LIMIT 1000`,
                [userId, documentId]
            );
            const nodes = await pool.query(
                `SELECT id, name, type, description FROM entities
                 WHERE user_id = $1 AND id IN (
                     SELECT source_entity_id FROM entity_relations WHERE user_id = $1 AND source_document_id = $2
                     UNION
                     SELECT target_entity_id FROM entity_relations WHERE user_id = $1 AND source_document_id = $2
                 )`,
                [userId, documentId]
            );
            return { nodes: nodes.rows, edges: edges.rows };
        }

        const nodes = await pool.query(
            `SELECT id, name, type, description FROM entities WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 300`,
            [userId]
        );
        const edges = await pool.query(
            `SELECT r.id, r.source_entity_id AS source, r.target_entity_id AS target, r.relation_type,
                    r.source_document_id, d.title AS source_document_title
             FROM entity_relations r
             LEFT JOIN documents d ON d.id = r.source_document_id
             WHERE r.user_id = $1
             LIMIT 1000`,
            [userId]
        );
        return { nodes: nodes.rows, edges: edges.rows };
    }

    /** Node detail plus its one-hop neighbourhood, for the graph explorer's detail panel. */
    async getEntityDetail(entityId: string, userId: string) {
        const entity = await pool.query(`SELECT * FROM entities WHERE id = $1 AND user_id = $2`, [entityId, userId]);
        if (entity.rows.length === 0) return null;

        const neighbors = await pool.query(
            `SELECT e.id, e.name, e.type, r.relation_type, r.excerpt, r.source_document_id, d.title AS source_document_title
             FROM entity_relations r
             JOIN entities e ON e.id = CASE WHEN r.source_entity_id = $1 THEN r.target_entity_id ELSE r.source_entity_id END
             LEFT JOIN documents d ON d.id = r.source_document_id
             WHERE r.user_id = $2 AND (r.source_entity_id = $1 OR r.target_entity_id = $1)
             LIMIT 50`,
            [entityId, userId]
        );

        return { entity: entity.rows[0], neighbors: neighbors.rows };
    }

    /** Returns null when the document does not exist or belongs to someone else. */
    async getExtractionStatus(documentId: string, userId: string): Promise<ExtractionStatus | null> {
        const doc = await pool.query(`SELECT status FROM documents WHERE id = $1 AND user_id = $2`, [documentId, userId]);
        if (doc.rows.length === 0) return null;

        const job = await pool.query(
            `SELECT status, error, attempts, updated_at FROM jobs WHERE ${DOCUMENT_JOB_FILTER} ORDER BY created_at DESC LIMIT 1`,
            [documentId]
        );
        const relations = await pool.query(
            `SELECT COUNT(*)::int AS count FROM entity_relations WHERE user_id = $1 AND source_document_id = $2`,
            [userId, documentId]
        );
        return { job: job.rows[0] ?? null, documentStatus: doc.rows[0].status, relationCount: relations.rows[0].count };
    }

    /**
     * Queues a (re-)extraction of one document's graph. A no-op while one is
     * already pending or running, so repeated clicks cannot burn the LLM quota.
     */
    async requestExtraction(documentId: string, userId: string): Promise<'queued' | 'already_queued' | 'not_ready' | 'not_found'> {
        const doc = await pool.query(`SELECT status FROM documents WHERE id = $1 AND user_id = $2`, [documentId, userId]);
        if (doc.rows.length === 0) return 'not_found';
        if (doc.rows[0].status !== 'READY') return 'not_ready';

        const active = await pool.query(
            `SELECT 1 FROM jobs WHERE ${DOCUMENT_JOB_FILTER} AND status IN ('PENDING', 'RUNNING') LIMIT 1`,
            [documentId]
        );
        if (active.rows.length > 0) return 'already_queued';

        await enqueue('EXTRACT_ENTITIES', { documentId, userId });
        return 'queued';
    }
}

export const graphService = new GraphService();
