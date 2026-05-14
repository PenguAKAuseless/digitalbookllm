import { Response, NextFunction } from 'express';
import { documentService } from '../services/documentService';
import { workspaceService } from '../services/workspaceService';
import { AuthRequest } from '../middleware/auth';
import * as fs from 'fs';

export class DocumentController {
    async uploadDocument(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No file uploaded' });
            }

            const { workspaceId } = req.body;
            if (!workspaceId) {
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                return res.status(400).json({ success: false, error: 'workspaceId is required' });
            }

            await workspaceService.assertOwnership(workspaceId, req.userId!);

            const { originalname, mimetype, size, path: filePath } = req.file;
            const fullText = await documentService.extractText(filePath, mimetype, originalname);

            if (!fullText.trim()) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                return res.status(400).json({ success: false, error: 'Document is empty or could not be parsed' });
            }

            const isPdf = mimetype === 'application/pdf';
            const documentId = await documentService.saveDocument(
                req.userId!,
                workspaceId,
                originalname,
                mimetype,
                size,
                fullText,
                isPdf ? filePath : undefined
            );

            if (!isPdf && fs.existsSync(filePath)) fs.unlinkSync(filePath);

            res.json({
                success: true,
                data: { documentId, name: originalname, fileType: mimetype, fileSize: size },
            });
        } catch (error) {
            if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            next(error);
        }
    }

    async getDocuments(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { workspaceId } = req.query as { workspaceId?: string };
            if (!workspaceId) {
                return res.status(400).json({ success: false, error: 'workspaceId query param is required' });
            }
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
            if (!document) {
                return res.status(404).json({ success: false, error: 'Document not found' });
            }
            res.json({ success: true, data: document });
        } catch (error) {
            next(error);
        }
    }

    async getPdfFile(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const document = await documentService.getDocument(req.params.id, req.userId!);
            if (!document) return res.status(404).json({ success: false, error: 'Document not found' });
            if (document.file_type !== 'application/pdf') {
                return res.status(400).json({ success: false, error: 'Not a PDF document' });
            }
            if (!document.file_path) {
                return res.status(404).json({ success: false, error: 'PDF file not stored. Please re-upload.' });
            }
            if (!require('fs').existsSync(document.file_path)) {
                return res.status(404).json({ success: false, error: 'PDF file missing on server. Please re-upload.' });
            }

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${document.name}"`);
            require('fs').createReadStream(document.file_path).pipe(res);
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
