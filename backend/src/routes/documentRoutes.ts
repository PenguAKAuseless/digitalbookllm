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
    const allowedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/markdown'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, DOCX, TXT, and MD files are allowed.'));
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
