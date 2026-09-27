import { v4 as uuid } from 'uuid';
import { pool } from '../db/config';

/**
 * Durable job queue backed by PostgreSQL (ADR-02). Replaces RabbitMQ/Celery so
 * concurrent uploads and knowledge-extraction requests queue instead of
 * overwhelming the API process (NFR02.2), with no external broker to host.
 */

export type JobType = 'INGEST_DOCUMENT' | 'EXTRACT_ENTITIES';

export interface Job {
    id: string;
    type: JobType;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, runAfter?: Date): Promise<string> {
    const id = uuid();
    await pool.query(
        `INSERT INTO jobs (id, type, payload, run_after)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP))`,
        [id, type, JSON.stringify(payload), runAfter?.toISOString() ?? null]
    );
    return id;
}

/** Atomically claims one pending job, marking it RUNNING. Returns null if the queue is empty. */
export async function claimNext(): Promise<Job | null> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT id, type, payload, attempts, max_attempts FROM jobs
             WHERE status = 'PENDING' AND run_after <= NOW()
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`
        );
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }
        const job = rows[0];
        await client.query(
            `UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
            [job.id]
        );
        await client.query('COMMIT');
        return { ...job, attempts: job.attempts + 1 };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function markDone(jobId: string): Promise<void> {
    await pool.query(`UPDATE jobs SET status = 'DONE', updated_at = NOW() WHERE id = $1`, [jobId]);
}

/** Requeues with exponential backoff, or moves to DEAD once max_attempts is exhausted. */
export async function markFailed(job: Job, error: string): Promise<void> {
    if (job.attempts >= job.max_attempts) {
        await pool.query(
            `UPDATE jobs SET status = 'DEAD', error = $2, updated_at = NOW() WHERE id = $1`,
            [job.id, error]
        );
        return;
    }
    const backoffSeconds = Math.min(60, 2 ** job.attempts);
    await pool.query(
        `UPDATE jobs SET status = 'PENDING', error = $2, run_after = NOW() + ($3 || ' seconds')::interval, updated_at = NOW()
         WHERE id = $1`,
        [job.id, error, String(backoffSeconds)]
    );
}
