import { Response, NextFunction } from 'express';
import { highlightService } from '../services/highlightService';
import { documentService } from '../services/documentService';
import { AuthRequest } from '../middleware/auth';

/** Highlights & bookmarks (UC10, UC11). */
export class HighlightController {
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await documentService.assertOwnership(req.params.documentId, req.userId!);
            const highlights = await highlightService.listForDocument(req.params.documentId, req.userId!);
            res.json({ success: true, data: highlights });
        } catch (error) {
            next(error);
        }
    }

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            await documentService.assertOwnership(req.params.documentId, req.userId!);
            const { type, content, note, color, locationMeta } = req.body;

            if (type !== 'HIGHLIGHT' && type !== 'BOOKMARK') {
                return res.status(400).json({ success: false, error: 'type must be HIGHLIGHT or BOOKMARK' });
            }
            if (!locationMeta?.page) {
                return res.status(400).json({ success: false, error: 'locationMeta.page is required' });
            }

            const highlight = await highlightService.create({
                documentId: req.params.documentId,
                userId: req.userId!,
                type,
                content,
                note,
                color,
                locationMeta,
            });
            res.status(201).json({ success: true, data: highlight });
        } catch (error) {
            next(error);
        }
    }

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const updated = await highlightService.update(req.params.id, req.userId!, req.body);
            if (!updated) return res.status(404).json({ success: false, error: 'Highlight not found' });
            res.json({ success: true, data: updated });
        } catch (error) {
            next(error);
        }
    }

    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const deleted = await highlightService.delete(req.params.id, req.userId!);
            if (!deleted) return res.status(404).json({ success: false, error: 'Highlight not found' });
            res.json({ success: true, message: 'Highlight deleted' });
        } catch (error) {
            next(error);
        }
    }
}

export const highlightController = new HighlightController();
