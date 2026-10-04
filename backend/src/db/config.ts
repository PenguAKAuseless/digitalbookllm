import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const dbPassword = typeof process.env.DB_PASSWORD === 'string'
    ? process.env.DB_PASSWORD
    : 'password';

export const pool = new Pool({
    ...(process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            user: process.env.DB_USER || 'postgres',
            password: dbPassword,
            database: process.env.DB_NAME || 'digitalbookllm',
        }),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// An idle connection can be dropped by the server (a managed Postgres or its pooler
// closes idle sessions, a restart, a network blip). The pool discards that client and
// opens a new one on the next query, so log it rather than taking the API down.
pool.on('error', (err: Error) => {
    console.error('[db] idle client error (connection discarded):', err.message);
});

export const testConnection = async () => {
    try {
        if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
            console.warn('DB_PASSWORD is not set. Using fallback password from configuration defaults.');
        }

        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        return true;
    } catch (error) {
        console.error('Database connection error:', error);
        return false;
    }
};
