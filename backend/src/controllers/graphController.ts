import { Response, NextFunction } from 'express';
import { graphService } from '../services/graphService';
import { AuthRequest } from '../middleware/auth';

/**
 * Graph responses may be stored by the browser but must be revalidated: with
 * Express's ETag, an unchanged graph (the common case while polling) costs a
 * 304 with no body instead of the full node/edge list.
 */
const REVALIDATE = 'private, no-cache';

/** Personal knowledge graph explorer (UC15, FR06). */
export class GraphController {
    async getGraph(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const documentId = typeof req.query.documentId === 'string' ? req.query.documentId : undefined;
            const graph = await graphService.getGraph(req.userId!, documentId);
            res.set('Cache-Control', REVALIDATE).json({ success: true, data: graph });
        } catch (error) {
            next(error);
        }
    }

    async getEntity(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const detail = await graphService.getEntityDetail(req.params.entityId, req.userId!);
            if (!detail) return res.status(404).json({ success: false, error: 'Entity not found' });
            res.set('Cache-Control', REVALIDATE).json({ success: true, data: detail });
        } catch (error) {
            next(error);
        }
    }

    async getExtractionStatus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const status = await graphService.getExtractionStatus(req.params.documentId, req.userId!);
            if (!status) return res.status(404).json({ success: false, error: 'Document not found' });
            res.json({ success: true, data: status });
        } catch (error) {
            next(error);
        }
    }

    async requestExtraction(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const result = await graphService.requestExtraction(req.params.documentId, req.userId!);
            if (result === 'not_found') return res.status(404).json({ success: false, error: 'Document not found' });
            if (result === 'not_ready') {
                return res.status(409).json({ success: false, error: 'Document is still being processed' });
            }
            res.status(202).json({ success: true, data: { result } });
        } catch (error) {
            next(error);
        }
    }
}

export const graphController = new GraphController();
