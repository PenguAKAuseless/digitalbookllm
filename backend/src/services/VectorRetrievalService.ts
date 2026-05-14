import { pool } from '../db/config';
import { RetrievedChunk } from '../types';

export class VectorRetrievalService {
    async retrieveRelevantChunks(
        documentId: string,
        queryEmbedding: number[],
        topK: number = 3,
        selectedText?: string
    ): Promise<RetrievedChunk[]> {
        const result = await pool.query(
            `SELECT id, text, 1 - (embedding <=> $1::vector) AS similarity
             FROM chunks
             WHERE document_id = $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            [JSON.stringify(queryEmbedding), documentId, topK]
        );

        let chunks = result.rows as RetrievedChunk[];

        if (selectedText) {
            chunks = chunks.filter((c) => this.jaccardSimilarity(c.text, selectedText) < 0.9);
        }

        return chunks;
    }

    async retrieveWorkspaceChunks(
        workspaceId: string,
        queryEmbedding: number[],
        topK: number = 5,
        selectedText?: string
    ): Promise<(RetrievedChunk & { document_name: string })[]> {
        const result = await pool.query(
            `SELECT c.id, c.text, d.name AS document_name,
                    1 - (c.embedding <=> $1::vector) AS similarity
             FROM chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE d.workspace_id = $2
             ORDER BY c.embedding <=> $1::vector
             LIMIT $3`,
            [JSON.stringify(queryEmbedding), workspaceId, topK]
        );

        let chunks = result.rows as (RetrievedChunk & { document_name: string })[];

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
