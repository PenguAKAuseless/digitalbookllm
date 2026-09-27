import { Response, NextFunction } from 'express';
import { graphService } from '../services/graphService';
import { AuthRequest } from '../middleware/auth';

/** Personal knowledge graph explorer (UC15, FR06). */
export class GraphController {
    async getGraph(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const graph = await graphService.getGraph(req.userId!);
            res.json({ success: true, data: graph });
        } catch (error) {
            next(error);
        }
    }

    async getEntity(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const detail = await graphService.getEntityDetail(req.params.entityId, req.userId!);
            if (!detail) return res.status(404).json({ success: false, error: 'Entity not found' });
            res.json({ success: true, data: detail });
        } catch (error) {
            next(error);
        }
    }
}

export const graphController = new GraphController();
