import { pool } from '../db/config';
import { RetrievedChunk } from '../types';
import { embeddingService } from '../llm/embeddings';
import { hybridRetrieve, RetrievalResult } from '../retrieval/hybridRetriever';
import { PgRetrievalStore, RetrievalScope } from '../retrieval/pgStore';

/**
 * Retrieval over pgvector (ADR-03), extended to a hybrid of dense similarity,
 * BM25 keyword matching and the user's knowledge graph, fused by reciprocal
 * rank (see src/retrieval). Every query is scoped by `user_id` in addition to
 * `document_id`/`workspace_id` — defense in depth against IDOR even though
 * ownership is also checked at the controller layer (NFR04.1).
 */
export class VectorRetrievalService {
    /** Full retrieval result for one scope: ranked chunks plus the knowledge-graph facts linked to the question. */
    async retrieveContext(params: {
        scope: RetrievalScope;
        userId: string;
        queryText: string;
        queryEmbedding: number[];
        topK: number;
        selectedText?: string;
    }): Promise<RetrievalResult> {
        const store = new PgRetrievalStore(params.userId, params.scope);
        const result = await hybridRetrieve(store, params.queryText, params.queryEmbedding, {
            topK: params.topK,
            embed: (text) => embeddingService.generateEmbedding(text),
        });
        if (params.selectedText) {
            // The selected passage is already in the prompt as hard context; don't spend a slot on the same text.
            result.chunks = result.chunks.filter((c) => this.jaccardSimilarity(c.text, params.selectedText!) < 0.9);
        }
        return result;
    }

    async retrieveRelevantChunks(
        documentId: string,
        userId: string,
        queryEmbedding: number[],
        topK: number = 3,
        selectedText?: string,
        queryText = ''
    ): Promise<RetrievedChunk[]> {
        const { rows } = await pool.query('SELECT workspace_id FROM documents WHERE id = $1 AND user_id = $2', [documentId, userId]);
        if (rows.length === 0) return [];
        const { chunks } = await this.retrieveContext({
            scope: { kind: 'document', documentId, workspaceId: rows[0].workspace_id }, userId, queryText, queryEmbedding, topK, selectedText,
        });
        return chunks;
    }

    async retrieveWorkspaceChunks(
        workspaceId: string,
        userId: string,
        queryEmbedding: number[],
        topK: number = 5,
        selectedText?: string,
        queryText = ''
    ): Promise<(RetrievedChunk & { document_name: string; document_id: string })[]> {
        const { chunks } = await this.retrieveContext({
            scope: { kind: 'workspace', workspaceId }, userId, queryText, queryEmbedding, topK, selectedText,
        });
        return chunks.map((c) => ({ ...c, document_name: c.document_name ?? '' }));
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
