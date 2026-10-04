import { Response, NextFunction } from 'express';
import { embeddingService } from '../llm/embeddings';
import { llmRouter } from '../llm/router';
import { ragService } from '../services/ragService';
import { vectorRetrievalService } from '../services/VectorRetrievalService';
import { workspaceService } from '../services/workspaceService';
import { documentService } from '../services/documentService';
import { enqueueChatExtraction } from '../queue/handlers/extractEntities';
import { AuthRequest } from '../middleware/auth';
import { Citation } from '../types';

const DOCUMENT_SIMILARITY_THRESHOLD = 0.2;

/** 1-based passage numbers cited in the answer as [n], [n, m] or [n][m], ignoring out-of-range numbers. */
export function citedPassageIndices(answer: string, passageCount: number): number[] {
    const cited = new Set<number>();
    for (const match of answer.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)) {
        for (const n of match[1].split(/[,;]/).map((s) => parseInt(s.trim(), 10))) {
            if (n >= 1 && n <= passageCount) cited.add(n);
        }
    }
    return [...cited].sort((a, b) => a - b);
}

/** Minimal SSE writer: one named event per call, JSON-encoded payload (NFR02.1). */
function sseWrite(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class RAGController {
    /**
     * Streams a RAG answer over SSE. Retrieval is document-first, falling back
     * to workspace-wide search (FR05); the selected text, when present, is
     * always injected as hard context (FR07). Citations reference the
     * retrieved chunk's page number for click-to-scroll in the reader (UC13).
     */
    async queryStream(req: AuthRequest, res: Response, next: NextFunction) {
        const { query, workspaceId, documentId, selectedText, topK = 5, sessionId } = req.body;

        if (!query?.trim()) return res.status(400).json({ success: false, error: 'query is required' });
        if (!workspaceId?.trim()) return res.status(400).json({ success: false, error: 'workspaceId is required' });

        try {
            await workspaceService.assertOwnership(workspaceId, req.userId!);

            const withinLimit = await ragService.checkRateLimit(req.userId!);
            if (!withinLimit) {
                return res.status(429).json({ success: false, error: 'Daily AI query limit reached. Try again tomorrow.' });
            }

            const safeTopK = Math.max(1, Math.min(20, Number(topK) || 5));
            const queryText = selectedText ? `${query} ${selectedText}` : query;
            const embedding = await embeddingService.generateEmbedding(queryText);

            let citations: Citation[] = [];
            let graphFacts: string[] = [];
            const retrieval = { userId: req.userId!, queryText, queryEmbedding: embedding, topK: safeTopK, selectedText };

            if (documentId?.trim()) {
                await documentService.assertOwnership(documentId, req.userId!);
                const result = await vectorRetrievalService.retrieveContext({
                    ...retrieval, scope: { kind: 'document', documentId, workspaceId },
                });
                if (result.chunks.length > 0 && result.topSimilarity >= DOCUMENT_SIMILARITY_THRESHOLD) {
                    // Passages reached through the knowledge graph may come from another book in the
                    // workspace; their citation names that book and opens it.
                    citations = result.chunks.map((c) => ({
                        chunkId: c.id, documentId: c.document_id,
                        documentName: c.document_id === documentId ? undefined : c.document_name,
                        page: c.page_number, text: c.text, similarity: c.similarity,
                    }));
                    graphFacts = result.graphFacts;
                }
            }

            if (citations.length === 0) {
                const result = await vectorRetrievalService.retrieveContext({ ...retrieval, scope: { kind: 'workspace', workspaceId } });
                citations = result.chunks.map((c) => ({
                    chunkId: c.id, documentId: c.document_id, documentName: c.document_name,
                    page: c.page_number, text: c.text, similarity: c.similarity,
                }));
                graphFacts = result.graphFacts;
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();

            if (citations.length === 0) {
                sseWrite(res, 'delta', { text: 'No documents found in this workspace. Upload a document first.' });
                sseWrite(res, 'done', { citations: [], messageId: null, sessionId: sessionId ?? null });
                return res.end();
            }

            // Sent before generation so the client (and the RAG evaluation harness) can
            // observe retrieval quality even when no LLM provider is available.
            sseWrite(res, 'citations', citations);

            let fullText = '';
            let usedProvider = 'unknown';

            try {
                for await (const chunk of llmRouter.generateAnswerStream(query, selectedText, citations, graphFacts)) {
                    if (chunk.provider) {
                        usedProvider = chunk.provider;
                        sseWrite(res, 'provider', { provider: usedProvider });
                    }
                    if (chunk.delta) {
                        fullText += chunk.delta;
                        sseWrite(res, 'delta', { text: chunk.delta });
                    }
                }
            } catch (err: any) {
                sseWrite(res, 'error', { error: err?.message || 'Generation failed' });
                return res.end();
            }

            await ragService.incrementQueryCount(req.userId!);

            // Which retrieved passages the answer actually cites ([n] markers), so the client
            // can tell supporting citations apart from passages that were only retrieved.
            const citedIndices = citedPassageIndices(fullText, citations.length);
            citations = citations.map((c, i) => ({ ...c, cited: citedIndices.includes(i + 1) }));

            const { messageId, sessionId: returnedSessionId } = await ragService.recordChatExchange({
                workspaceId,
                documentId: documentId || undefined,
                userId: req.userId!,
                query,
                response: fullText,
                selectedText,
                citations,
                sessionId,
                provider: usedProvider,
            });

            // Grow the knowledge graph from this interaction in the background (FR06, UC15).
            await enqueueChatExtraction(
                req.userId!,
                documentId || undefined,
                [selectedText, query, fullText].filter(Boolean).join('\n\n')
            );

            sseWrite(res, 'done', { messageId, sessionId: returnedSessionId, citedIndices });
            res.end();
        } catch (error) {
            next(error);
        }
    }

    async getSessionHistory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const history = await ragService.getSessionHistory(req.params.sessionId, req.userId!);
            res.json({ success: true, data: history });
        } catch (error) {
            next(error);
        }
    }

    async getWorkspaceSessions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await workspaceService.assertOwnership(req.params.workspaceId, req.userId!);
            const sessions = await ragService.getWorkspaceSessions(req.params.workspaceId, req.userId!);
            res.json({ success: true, data: sessions });
        } catch (error) {
            next(error);
        }
    }

    async deleteSession(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const deleted = await ragService.deleteSession(req.params.sessionId, req.userId!);
            if (!deleted) return res.status(404).json({ success: false, error: 'Session not found' });
            res.json({ success: true, message: 'Session deleted' });
        } catch (error) {
            next(error);
        }
    }
}

export const ragController = new RAGController();
