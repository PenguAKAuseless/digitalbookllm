import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';

import authRoutes from './routes/authRoutes';
import workspaceRoutes from './routes/workspaceRoutes';
import documentRoutes from './routes/documentRoutes';
import ragRoutes from './routes/ragRoutes';
import graphRoutes from './routes/graphRoutes';
import ttsRoutes from './routes/ttsRoutes';
import systemRoutes from './routes/systemRoutes';

/**
 * Express app wiring, separated from the process bootstrap (db check, worker
 * pool, listen) in index.ts so integration tests can import and exercise the
 * app directly via supertest without starting a real server or worker pool.
 */
export function createApp() {
    const app = express();

    app.use(helmet());
    app.use(cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    }));
    if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
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
    app.use('/api/graph', graphRoutes);
    app.use('/api/tts', ttsRoutes);
    app.use('/api/system', systemRoutes);

    app.use(notFound);
    app.use(errorHandler);

    return app;
}
