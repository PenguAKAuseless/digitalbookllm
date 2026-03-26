import { Request, Response, NextFunction } from 'express';
import { documentService } from '../services/documentService';
import * as fs from 'fs';

export class DocumentController {
    async uploadDocument(req: Request, res: Response, next: NextFunction) {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file uploaded'
                });
            }

            const userId = req.body.userId || 'guest';
            const { originalname, mimetype, size, path: filePath } = req.file;

            // Extract text from document
            const fullText = await documentService.extractText(filePath, mimetype, originalname);

            if (!fullText.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'Document is empty or could not be parsed'
                });
            }

            // Save document and generate embeddings
            // Keep PDF files for direct serving, delete others after processing
            const documentId = await documentService.saveDocument(
                userId,
                originalname,
                mimetype,
                size,
                fullText,
                mimetype === 'application/pdf' ? filePath : undefined
            );

            // Clean up uploaded file (except PDFs which we keep)
            if (mimetype !== 'application/pdf' && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            res.json({
                success: true,
                data: {
                    documentId,
                    name: originalname,
                    fileType: mimetype,
                    fileSize: size,
                    message: 'Document uploaded and processed successfully'
                }
            });
        } catch (error) {
            next(error);
        }
    }

    async getDocuments(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.query.userId as string || 'guest';
            const documents = await documentService.getUserDocuments(userId);

            res.json({
                success: true,
                data: documents
            });
        } catch (error) {
            next(error);
        }
    }

    async getDocument(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const document = await documentService.getDocument(id);

            if (!document) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }

            res.json({
                success: true,
                data: document
            });
        } catch (error) {
            next(error);
        }
    }

    async getPdfFile(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;

            const document = await documentService.getDocument(id);

            if (!document) {
                return res.status(404).json({
                    success: false,
                    error: 'Document not found'
                });
            }

            if (document.file_type !== 'application/pdf') {
                return res.status(400).json({
                    success: false,
                    error: 'Document is not a PDF file'
                });
            }

            if (!document.file_path) {
                return res.status(400).json({
                    success: false,
                    error: 'PDF file path not available. This may be an old document uploaded before PDF storage was enabled. Please re-upload the document.'
                });
            }

            if (!fs.existsSync(document.file_path)) {
                return res.status(404).json({
                    success: false,
                    error: 'PDF file not found on server. Please re-upload the document.'
                });
            }

            // Serve the PDF file
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${document.name}"`);

            const fileStream = fs.createReadStream(document.file_path);
            fileStream.pipe(res);
        } catch (error) {
            next(error);
        }
    }

    async deleteDocument(req: Request, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            await documentService.deleteDocument(id);

            res.json({
                success: true,
                message: 'Document deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    }
}

export const documentController = new DocumentController();
