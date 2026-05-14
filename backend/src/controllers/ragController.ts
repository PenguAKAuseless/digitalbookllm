import { Response, NextFunction } from 'express';
import { embeddingService } from '../services/embeddingService';
import { llmRouterService } from '../services/LLMRouterService';
import { ragService } from '../services/ragService';
import { vectorRetrievalService } from '../services/VectorRetrievalService';
import { workspaceService } from '../services/workspaceService';
import { documentService } from '../services/documentService';
import { AuthRequest } from '../middleware/auth';

const DOCUMENT_SIMILARITY_THRESHOLD = 0.2;

export class RAGController {
    async query(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { query, workspaceId, documentId, selectedText, topK = 5, sessionId } = req.body;

            if (!query?.trim()) return res.status(400).json({ success: false, error: 'query is required' });
            if (!workspaceId?.trim()) return res.status(400).json({ success: false, error: 'workspaceId is required' });

            await workspaceService.assertOwnership(workspaceId, req.userId!);

            const safeTopK = Math.max(1, Math.min(20, Number(topK) || 5));
            const queryText = selectedText ? `${query} ${selectedText}` : query;
            const embedding = await embeddingService.generateEmbedding(queryText);

            let chunks: Array<{ id: string; text: string; similarity: number; document_name?: string }> = [];
            let source: 'document' | 'workspace' | 'none' = 'none';

            // 1. Try document-level first if a document is selected
            if (documentId?.trim()) {
                const docChunks = await vectorRetrievalService.retrieveRelevantChunks(documentId, embedding, safeTopK, selectedText);
                if (docChunks.length > 0 && docChunks[0].similarity >= DOCUMENT_SIMILARITY_THRESHOLD) {
                    chunks = docChunks;
                    source = 'document';
                }
            }

            // 2. Fall through to workspace-wide retrieval
            if (chunks.length === 0) {
                const wsChunks = await vectorRetrievalService.retrieveWorkspaceChunks(workspaceId, embedding, safeTopK, selectedText);
                if (wsChunks.length > 0) {
                    chunks = wsChunks;
                    source = 'workspace';
                }
            }

            if (chunks.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        response: 'No documents found in this workspace. Upload a document first to start chatting.',
                        retrievedChunks: [],
                        messageId: null,
                        source: 'none',
                    },
                });
            }

            let response: string;
            let provider: string;
            try {
                const result = await llmRouterService.generateResponse(query, selectedText, chunks);
                response = result.text;
                provider = result.provider;
            } catch (err: any) {
                return res.status(503).json({
                    success: false,
                    error: err?.message || 'No LLM provider available. Configure an API key (TOGETHER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY) or run Ollama locally.',
                });
            }

            let sourceDocumentName: string | undefined;
            if (source === 'document' && documentId) {
                const doc = await documentService.getDocument(documentId, req.userId!);
                sourceDocumentName = doc?.name;
            } else if (source === 'workspace') {
                sourceDocumentName = (chunks[0] as any)?.document_name;
            }

            const { messageId, sessionId: returnedSessionId } = await ragService.recordChatExchange({
                workspaceId,
                documentId: source === 'document' ? documentId : undefined,
                userId: req.userId!,
                query,
                response,
                selectedText,
                retrievedChunks: chunks,
                sessionId,
                source,
                sourceDocumentName,
                provider,
            });

            res.json({
                success: true,
                data: {
                    response,
                    retrievedChunks: chunks.map((c) => ({
                        text: c.text,
                        similarity: c.similarity,
                        documentName: (c as any).document_name,
                    })),
                    messageId,
                    sessionId: returnedSessionId,
                    source,
                    sourceDocumentName,
                    provider,
                },
            });
        } catch (error) {
            next(error);
        }
    }

    async getSessionHistory(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const history = await ragService.getSessionHistory(req.params.sessionId);
            res.json({ success: true, data: history });
        } catch (error) {
            next(error);
        }
    }

    async getWorkspaceSessions(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { workspaceId } = req.params;
            await workspaceService.assertOwnership(workspaceId, req.userId!);
            const sessions = await ragService.getWorkspaceSessions(workspaceId, req.userId!);
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
