import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { documentController } from '../controllers/documentController';
import { uploadLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';
import highlightRoutes from './highlightRoutes';

const router = Router();

// Local-file streaming is served publicly with Range support (dev-only storage driver — see ADR-05);
// it must sit before requireAuth since <img>/<iframe>/pdf.js requests don't carry an Authorization header.
router.get('/local-file', documentController.serveLocalFile);

router.use(requireAuth);

// Buffered in memory: files are forwarded straight to object storage, never written to local disk
// (both free-tier API hosts provide only ephemeral disk — see ADR-05).
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const mime = (file.mimetype || '').toLowerCase();
        const ext = path.extname(file.originalname || '').toLowerCase();
        const allowedExts = new Set(['.pdf', '.epub', '.docx', '.txt', '.md']);
        const allowedMimes = new Set([
            'application/pdf',
            'application/epub+zip',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);
        if (mime.startsWith('text/') || allowedMimes.has(mime) || allowedExts.has(ext)) {
            cb(null, true);
        } else {
            cb(Object.assign(new Error('Unsupported file type. Supported: PDF, EPUB, DOCX, TXT, MD.'), { statusCode: 415 }));
        }
    },
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024 },
});

router.post('/upload', uploadLimiter, upload.single('file'), documentController.uploadDocument);
router.get('/', documentController.getDocuments);
router.get('/:id/status', documentController.getStatus);
router.get('/:id/file', documentController.getFileUrl);
router.get('/:id/cover', documentController.getCoverUrl);
router.put('/:id/progress', documentController.updateProgress);
router.use('/:documentId/highlights', highlightRoutes);
router.get('/:id', documentController.getDocument);
router.delete('/:id', documentController.deleteDocument);

export default router;
