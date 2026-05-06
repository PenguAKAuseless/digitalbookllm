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
            `SELECT id, text,
              1 - (embedding <=> $1::vector) as similarity
       FROM chunks
       WHERE document_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
            [JSON.stringify(queryEmbedding), documentId, topK]
        );

        let chunks = result.rows as RetrievedChunk[];

        if (selectedText) {
            chunks = chunks.filter((chunk) => {
                const similarity = this.textSimilarity(chunk.text, selectedText);
                return similarity < 0.9;
            });
        }

        return chunks;
    }

    private textSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));

        const intersection = new Set([...words1].filter((word) => words2.has(word)));
        const union = new Set([...words1, ...words2]);

        if (union.size === 0) {
            return 0;
        }

        return intersection.size / union.size;
    }
}

export const vectorRetrievalService = new VectorRetrievalService();
