import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import * as fs from 'fs';

import { testConnection } from './db/config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';

import authRoutes from './routes/authRoutes';
import workspaceRoutes from './routes/workspaceRoutes';
import documentRoutes from './routes/documentRoutes';
import ragRoutes from './routes/ragRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiLimiter);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'DigitalBookLLM API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/rag', ragRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
    try {
        if (!process.env.JWT_SECRET) {
            console.warn('[WARN] JWT_SECRET not set — using insecure default. Set it in .env for production.');
        }

        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('Failed to connect to database. Check DB config and ensure PostgreSQL is running.');
            process.exit(1);
        }

        app.listen(PORT, () => {
            console.log(`[Server] Running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
