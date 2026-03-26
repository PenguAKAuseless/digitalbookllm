import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { documentController } from '../controllers/documentController';
import { uploadLimiter } from '../middleware/rateLimit';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, process.env.UPLOAD_DIR || './uploads');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const mimeType = (file.mimetype || '').toLowerCase();
    const extension = path.extname(file.originalname || '').toLowerCase();

    const allowedMimeTypes = new Set([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/json',
        'application/xml',
        'application/x-yaml',
        'application/yaml',
        'application/javascript',
        'application/x-javascript',
        'application/typescript'
    ]);

    const allowedTextExtensions = new Set([
        '.pdf', '.docx', '.doc',
        '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml',
        '.log', '.ini', '.cfg', '.conf', '.sql', '.py', '.js', '.ts', '.tsx', '.jsx', '.html',
        '.css', '.scss', '.sass', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.rb',
        '.php', '.sh', '.bat', '.ps1', '.rtf'
    ]);

    const isSupportedText = mimeType.startsWith('text/') || allowedMimeTypes.has(mimeType) || allowedTextExtensions.has(extension);

    if (isSupportedText) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Supported files include PDF, DOCX, and text-based documents.'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024 // MB to bytes
    }
});

// Routes
router.post('/upload', uploadLimiter, upload.single('file'), documentController.uploadDocument);
router.get('/', documentController.getDocuments);
router.get('/:id/pdf', documentController.getPdfFile); // More specific route must come first
router.get('/:id', documentController.getDocument);
router.delete('/:id', documentController.deleteDocument);

export default router;
