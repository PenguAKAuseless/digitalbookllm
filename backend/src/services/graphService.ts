import { pool } from '../db/config';

/** Knowledge graph queries (UC15), stored relationally per ADR-04. */
export class GraphService {
    async getGraph(userId: string) {
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
}

export const graphService = new GraphService();
