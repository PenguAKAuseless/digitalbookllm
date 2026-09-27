import { Response, NextFunction, Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { documentService } from '../services/documentService';
import { workspaceService } from '../services/workspaceService';
import { storage } from '../storage';
import { AuthRequest } from '../middleware/auth';

export class DocumentController {
    /** Accepts the raw file, persists it to object storage, and enqueues async ingestion (FR03/FR04/FR05). */
    async uploadDocument(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

            const { workspaceId } = req.body;
            if (!workspaceId) return res.status(400).json({ success: false, error: 'workspaceId is required' });

            await workspaceService.assertOwnership(workspaceId, req.userId!);

            const { originalname, mimetype, size, buffer } = req.file;
            const result = await documentService.uploadDocument(req.userId!, workspaceId, originalname, mimetype, size, buffer);

            // 202 Accepted: ingestion is asynchronous; the client polls /status (NFR02.2).
            res.status(202).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }

    async getDocuments(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { workspaceId } = req.query as { workspaceId?: string };
            if (!workspaceId) return res.status(400).json({ success: false, error: 'workspaceId query param is required' });
            await workspaceService.assertOwnership(workspaceId, req.userId!);
            const documents = await documentService.getWorkspaceDocuments(workspaceId, req.userId!);
            res.json({ success: true, data: documents });
        } catch (error) {
            next(error);
        }
    }

    async getDocument(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const document = await documentService.getDocument(req.params.id, req.userId!);
            if (!document) return res.status(404).json({ success: false, error: 'Document not found' });
            res.json({ success: true, data: document });
        } catch (error) {
            next(error);
        }
    }

    async getStatus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const status = await documentService.getStatus(req.params.id, req.userId!);
            if (!status) return res.status(404).json({ success: false, error: 'Document not found' });
            res.json({ success: true, data: status });
        } catch (error) {
            next(error);
        }
    }

    /** Returns a signed URL the client fetches directly (progressive/range-capable — see ADR-09). */
    async getFileUrl(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const document = await documentService.getDocument(req.params.id, req.userId!);
            if (!document) return res.status(404).json({ success: false, error: 'Document not found' });
            const url = await storage().getSignedUrl(document.storage_key);
            res.json({ success: true, data: { url, fileType: document.file_type } });
        } catch (error) {
            next(error);
        }
    }

    async getCoverUrl(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const document = await documentService.getDocument(req.params.id, req.userId!);
            if (!document) return res.status(404).json({ success: false, error: 'Document not found' });
            if (!document.cover_key) return res.status(404).json({ success: false, error: 'No cover available yet' });
            const url = await storage().getSignedUrl(document.cover_key);
            res.json({ success: true, data: { url } });
        } catch (error) {
            next(error);
        }
    }

    async updateProgress(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { page } = req.body;
            if (!Number.isInteger(page) || page < 1) {
                return res.status(400).json({ success: false, error: 'page must be a positive integer' });
            }
            await documentService.updateLastReadPage(req.params.id, req.userId!, page);
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Range-capable file serving for the local storage driver (dev only —
     * Supabase's signed URLs already support Range natively). Enables the
     * same progressive-load behavior in both environments (ADR-09).
     */
    async serveLocalFile(req: Request, res: Response, next: NextFunction) {
        try {
            const key = req.query.key as string;
            if (!key) return res.status(400).json({ success: false, error: 'key is required' });

            const baseDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
            const filePath = path.resolve(baseDir, key);
            if (!filePath.startsWith(baseDir) || !fs.existsSync(filePath)) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }

            const stat = fs.statSync(filePath);
            const range = req.headers.range;

            if (!range) {
                res.setHeader('Content-Length', stat.size);
                res.setHeader('Accept-Ranges', 'bytes');
                fs.createReadStream(filePath).pipe(res);
                return;
            }

            const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
            const start = parseInt(startStr, 10);
            const end = endStr ? parseInt(endStr, 10) : stat.size - 1;

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', end - start + 1);
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } catch (error) {
            next(error);
        }
    }

    async deleteDocument(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const deleted = await documentService.deleteDocument(req.params.id, req.userId!);
            if (!deleted) return res.status(404).json({ success: false, error: 'Document not found' });
            res.json({ success: true, message: 'Document deleted' });
        } catch (error) {
            next(error);
        }
    }
}

export const documentController = new DocumentController();
