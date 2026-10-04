import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { testConnection } from './db/config';
import { WorkerPool } from './queue/workerPool';
import { handleIngestDocument } from './queue/handlers/ingest';
import { handleExtractEntities } from './queue/handlers/extractEntities';
import { embeddingService } from './llm/embeddings';

const app = createApp();
const PORT = process.env.PORT || 3001;

// Worker pool runs in the same process as the API server so a single free
// container hosts both the request path and the async ingestion/knowledge
// pipeline (see ADR-02 and ADR-12). One job at a time by default: on a free
// instance (512 MB, shared CPU) two concurrent ingestions plus the embedding
// model left the API unresponsive. Set WORKER_CONCURRENCY to raise it.
const workerPool = new WorkerPool(parseInt(process.env.WORKER_CONCURRENCY || '1'));
workerPool.register('INGEST_DOCUMENT', handleIngestDocument);
workerPool.register('EXTRACT_ENTITIES', handleExtractEntities);

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

        workerPool.start();

        // Load the embedding model now rather than inside the first ingestion
        // job or chat request; failures are retried lazily on first use.
        embeddingService.initialize().catch((err) => console.warn('[Server] Embedding model warm-up failed:', err));

        app.listen(Number(PORT), '0.0.0.0', () => {
            console.log(`[Server] Running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
