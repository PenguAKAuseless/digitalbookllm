import { Request, Response, NextFunction } from 'express';
import { embeddingService } from '../services/embeddingService';
import { llmGenerationService } from '../services/LLMGenerationService';
import { ragService } from '../services/ragService';
import { vectorRetrievalService } from '../services/VectorRetrievalService';
import { QueryRequest, QueryResponse } from '../types';

export class RAGController {
    async query(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.body.userId || 'guest';
            const queryRequest: QueryRequest = req.body;

            if (!queryRequest.query?.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'Query text is required'
                });
            }

            if (!queryRequest.documentId?.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'Document ID is required'
                });
            }

            const canQuery = await ragService.checkRateLimit(userId);
            if (!canQuery) {
                return res.status(429).json({
                    success: false,
                    error: 'Daily query limit reached. Please try again tomorrow.'
                });
            }

            const { query, documentId, selectedText, topK = 3 } = queryRequest;
            const safeTopK = Number.isFinite(topK) ? Math.max(1, Math.min(10, topK)) : 3;

            const queryText = selectedText ? `${query} ${selectedText}` : query;
            const queryEmbedding = await embeddingService.generateEmbedding(queryText);

            const retrievedChunks = await vectorRetrievalService.retrieveRelevantChunks(
                documentId,
                queryEmbedding,
                safeTopK,
                selectedText
            );

            const response = await llmGenerationService.generateResponse(
                query,
                selectedText,
                retrievedChunks
            );

            const messageId = await ragService.recordChatExchange({
                documentId,
                userId,
                query,
                response,
                selectedText,
                retrievedChunks
            });

            await ragService.incrementQueryCount(userId);

            const result: QueryResponse = {
                response,
                retrievedChunks: retrievedChunks.map((chunk) => ({
                    text: chunk.text,
                    similarity: chunk.similarity
                })),
                messageId
            };

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            next(error);
        }
    }

    async getChatHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const { documentId } = req.params;
            const userId = req.query.userId as string || 'guest';

            const history = await ragService.getChatHistory(documentId, userId);

            res.json({
                success: true,
                data: history
            });
        } catch (error) {
            next(error);
        }
    }

    async getQueryCount(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.query.userId as string || 'guest';
            const queryCount = await ragService.getQueryCount(userId);

            res.json({
                success: true,
                data: queryCount
            });
        } catch (error) {
            next(error);
        }
    }
}

export const ragController = new RAGController();
