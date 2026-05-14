import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { documentController } from '../controllers/documentController';
import { uploadLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, process.env.UPLOAD_DIR || './uploads');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `upload-${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();

    const allowedMimes = new Set([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/json', 'application/xml', 'application/x-yaml', 'application/yaml',
        'application/javascript', 'application/x-javascript', 'application/typescript',
    ]);

    const allowedExts = new Set([
        '.pdf', '.docx', '.doc', '.txt', '.md', '.markdown', '.csv', '.tsv',
        '.json', '.xml', '.yaml', '.yml', '.log', '.ini', '.cfg', '.conf',
        '.sql', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.scss',
        '.sass', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.rb',
        '.php', '.sh', '.bat', '.ps1', '.rtf',
    ]);

    if (mime.startsWith('text/') || allowedMimes.has(mime) || allowedExts.has(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Unsupported file type. Supported: PDF, DOCX, TXT, MD, and other text formats.'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024 },
});

router.post('/upload', uploadLimiter, upload.single('file'), documentController.uploadDocument);
router.get('/', documentController.getDocuments);
router.get('/:id/pdf', documentController.getPdfFile);
router.get('/:id', documentController.getDocument);
router.delete('/:id', documentController.deleteDocument);

export default router;
