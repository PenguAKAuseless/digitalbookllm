import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import * as fs from 'fs';

import { testConnection } from './db/config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';

import documentRoutes from './routes/documentRoutes';
import ragRoutes from './routes/ragRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const ensureRequiredEnv = () => {
    const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
    const requiredDbEnv = ['DB_HOST', 'DB_USER', 'DB_NAME'];
    const missingDbEnv = requiredDbEnv.filter((key) => !process.env[key]?.trim());

    if (!hasDatabaseUrl && missingDbEnv.length > 0) {
        throw new Error(
            `Missing required database environment variables. Set DATABASE_URL or ${missingDbEnv.join(', ')}.`
        );
    }
};

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiLimiter);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'DigitalBookLLM API'
    });
});

app.use('/api/documents', documentRoutes);
app.use('/api/rag', ragRoutes);

app.use(notFound);
app.use(errorHandler);

async function startServer() {
    try {
        ensureRequiredEnv();

        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('Failed to connect to database. Check configuration and database status.');
            process.exit(1);
        }

        app.listen(PORT);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
