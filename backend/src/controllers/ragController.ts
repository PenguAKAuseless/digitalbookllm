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

            if (documentId?.trim()) {
                await documentService.assertOwnership(documentId, req.userId!);
                const docChunks = await vectorRetrievalService.retrieveRelevantChunks(
                    documentId, req.userId!, embedding, safeTopK, selectedText
                );
                if (docChunks.length > 0 && docChunks[0].similarity >= DOCUMENT_SIMILARITY_THRESHOLD) {
                    citations = docChunks.map((c) => ({
                        chunkId: c.id, documentId, page: c.page_number, text: c.text, similarity: c.similarity,
                    }));
                }
            }

            if (citations.length === 0) {
                const wsChunks = await vectorRetrievalService.retrieveWorkspaceChunks(
                    workspaceId, req.userId!, embedding, safeTopK, selectedText
                );
                citations = wsChunks.map((c) => ({
                    chunkId: c.id, documentId: c.document_id, documentName: c.document_name,
                    page: c.page_number, text: c.text, similarity: c.similarity,
                }));
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
                for await (const chunk of llmRouter.generateAnswerStream(query, selectedText, citations)) {
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

            sseWrite(res, 'done', { messageId, sessionId: returnedSessionId });
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
