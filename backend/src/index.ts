import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { testConnection } from './db/config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';

import documentRoutes from './routes/documentRoutes';
import ragRoutes from './routes/ragRoutes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create uploads directory if it doesn't exist
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting to all routes
app.use('/api', apiLimiter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'DigitalBookLLM API'
    });
});

// API Routes
app.use('/api/documents', documentRoutes);
app.use('/api/rag', ragRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
async function startServer() {
    try {
        // Test database connection
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('❌ Failed to connect to database. Please check your configuration.');
            console.log('💡 Make sure PostgreSQL is running and .env file is configured correctly.');
            console.log('💡 Run: npm run migrate to create database tables.');
            process.exit(1);
        }

        app.listen(PORT, () => {
            console.log('\n🚀 DigitalBookLLM Backend Server Started!');
            console.log(`📍 Server running on http://localhost:${PORT}`);
            console.log(`🔗 API endpoint: http://localhost:${PORT}/api`);
            console.log(`💾 Upload directory: ${path.resolve(uploadDir)}`);
            console.log(`\n📚 Available endpoints:`);
            console.log(`   POST   /api/documents/upload       - Upload a document`);
            console.log(`   GET    /api/documents              - Get all documents`);
            console.log(`   GET    /api/documents/:id          - Get a specific document`);
            console.log(`   DELETE /api/documents/:id          - Delete a document`);
            console.log(`   POST   /api/rag/query              - Query with RAG`);
            console.log(`   GET    /api/rag/history/:documentId - Get chat history`);
            console.log(`   GET    /api/rag/query-count        - Get query count\n`);
            console.log(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔐 Rate limit: ${process.env.MAX_QUERIES_PER_DAY || 50} queries/day\n`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
