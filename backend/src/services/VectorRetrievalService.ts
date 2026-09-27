import { pool } from '../db/config';
import { RetrievedChunk } from '../types';

/**
 * Similarity search over pgvector (ADR-03). Every query is scoped by
 * `user_id` in addition to `document_id`/`workspace_id` — defense in depth
 * against IDOR even though ownership is also checked at the controller layer
 * (NFR04.1).
 */
export class VectorRetrievalService {
    async retrieveRelevantChunks(
        documentId: string,
        userId: string,
        queryEmbedding: number[],
        topK: number = 3,
        selectedText?: string
    ): Promise<RetrievedChunk[]> {
        const result = await pool.query(
            `SELECT id, text, page_number, 1 - (embedding <=> $1::vector) AS similarity
             FROM chunks
             WHERE document_id = $2 AND user_id = $3
             ORDER BY embedding <=> $1::vector
             LIMIT $4`,
            [JSON.stringify(queryEmbedding), documentId, userId, topK]
        );

        let chunks = result.rows as RetrievedChunk[];
        if (selectedText) {
            chunks = chunks.filter((c) => this.jaccardSimilarity(c.text, selectedText) < 0.9);
        }
        return chunks;
    }

    async retrieveWorkspaceChunks(
        workspaceId: string,
        userId: string,
        queryEmbedding: number[],
        topK: number = 5,
        selectedText?: string
    ): Promise<(RetrievedChunk & { document_name: string; document_id: string })[]> {
        const result = await pool.query(
            `SELECT c.id, c.text, c.page_number, c.document_id, d.title AS document_name,
                    1 - (c.embedding <=> $1::vector) AS similarity
             FROM chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE d.workspace_id = $2 AND c.user_id = $3
             ORDER BY c.embedding <=> $1::vector
             LIMIT $4`,
            [JSON.stringify(queryEmbedding), workspaceId, userId, topK]
        );

        let chunks = result.rows as (RetrievedChunk & { document_name: string; document_id: string })[];
        if (selectedText) {
            chunks = chunks.filter((c) => this.jaccardSimilarity(c.text, selectedText) < 0.9);
        }
        return chunks;
    }

    private jaccardSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));
        const intersection = new Set([...words1].filter((w) => words2.has(w)));
        const union = new Set([...words1, ...words2]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    }
}

export const vectorRetrievalService = new VectorRetrievalService();
