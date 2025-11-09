import { Request, Response, NextFunction } from 'express';
import { ragService } from '../services/ragService';
import { QueryRequest } from '../types';

export class RAGController {
    async query(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.body.userId || 'guest';
            const queryRequest: QueryRequest = req.body;

            // Check rate limit
            const canQuery = await ragService.checkRateLimit(userId);
            if (!canQuery) {
                return res.status(429).json({
                    success: false,
                    error: 'Daily query limit reached. Please try again tomorrow.'
                });
            }

            // Process query
            const result = await ragService.processQuery(userId, queryRequest);

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
