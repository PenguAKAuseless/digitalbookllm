import { v4 as uuid } from 'uuid';
import { pool } from '../db/config';

/**
 * Durable job queue backed by PostgreSQL (ADR-02). Replaces RabbitMQ/Celery so
 * concurrent uploads and knowledge-extraction requests queue instead of
 * overwhelming the API process (NFR02.2), with no external broker to host.
 */

export type JobType = 'INGEST_DOCUMENT' | 'EXTRACT_ENTITIES';

const RETRY_BASE_SECONDS = parseInt(process.env.JOB_RETRY_BASE_SECONDS || '20');
/** How often a running job refreshes its updated_at. */
export const HEARTBEAT_MS = 30_000;
/** A RUNNING job without a heartbeat for this long belongs to a worker that is gone. */
const STALE_AFTER_MS = 5 * HEARTBEAT_MS;

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
        await client.query('ROLLBACK').catch(() => {}); // the connection itself may be what failed
        throw err;
    } finally {
        client.release();
    }
}

/** Marks a running job as alive, so the stale-job sweep never reclaims it. */
export async function heartbeat(jobId: string): Promise<void> {
    await pool.query(`UPDATE jobs SET updated_at = NOW() WHERE id = $1 AND status = 'RUNNING'`, [jobId]);
}

/**
 * Returns jobs left RUNNING by a worker that stopped mid-job (process killed,
 * redeploy, out of memory) to the queue, or to DEAD once their attempts are
 * spent. Live jobs send a heartbeat every HEARTBEAT_MS, so only jobs silent
 * for STALE_AFTER_MS are touched.
 */
export async function requeueStaleJobs(): Promise<number> {
    const { rows } = await pool.query(
        `UPDATE jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'PENDING' END,
             error = 'Worker stopped while the job was running',
             run_after = NOW(), updated_at = NOW()
         WHERE status = 'RUNNING' AND updated_at < NOW() - ($1 || ' milliseconds')::interval
         RETURNING type, status, payload->>'documentId' AS document_id`,
        [String(STALE_AFTER_MS)]
    );
    // A document whose ingestion will not be retried must not stay "processing" forever.
    const deadIngests = rows.filter((r) => r.type === 'INGEST_DOCUMENT' && r.status === 'DEAD' && r.document_id).map((r) => r.document_id);
    if (deadIngests.length > 0) {
        await pool.query(
            `UPDATE documents SET status = 'FAILED', status_detail = 'Processing was interrupted; please upload the file again.', updated_at = NOW()
             WHERE id = ANY($1::text[]) AND status IN ('UPLOADED', 'PROCESSING')`,
            [deadIngests]
        );
    }
    return rows.length;
}

export async function markDone(jobId: string): Promise<void> {
    await pool.query(`UPDATE jobs SET status = 'DONE', error = NULL, updated_at = NOW() WHERE id = $1`, [jobId]);
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
    // 20s, 40s, ... (capped at 5 min): long enough for a provider to recover from an
    // outage or a model to reload, where a 2-4s retry would fail the same way.
    const backoffSeconds = Math.min(300, RETRY_BASE_SECONDS * 2 ** (job.attempts - 1));
    await pool.query(
        `UPDATE jobs SET status = 'PENDING', error = $2, run_after = NOW() + ($3 || ' seconds')::interval, updated_at = NOW()
         WHERE id = $1`,
        [job.id, error, String(backoffSeconds)]
    );
}
