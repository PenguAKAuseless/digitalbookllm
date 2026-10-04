import { v4 as uuid } from 'uuid';
import { describeIfDb, registerUser, createWorkspace, closePool } from '../helpers/testApp';
import { pool } from '../../src/db/config';
import { heartbeat, markFailed, requeueStaleJobs } from '../../src/queue/jobQueue';

/**
 * NFR02.2 recovery: jobs left RUNNING by a worker that died (process killed,
 * redeploy, out of memory) go back to the queue instead of hanging forever,
 * and a document whose ingestion is abandoned is marked FAILED, not left "processing".
 */
describeIfDb('Job queue recovery', () => {
    let userId: string;
    let workspaceId: string;

    beforeAll(async () => {
        const user = await registerUser();
        userId = user.userId;
        workspaceId = (await createWorkspace(user.token)).id;
    });

    afterAll(async () => {
        await closePool();
    });

    async function insertJob(type: string, payload: object, status: string, attempts: number, silentForSeconds: number) {
        const id = uuid();
        await pool.query(
            `INSERT INTO jobs (id, type, payload, status, attempts, max_attempts, updated_at)
             VALUES ($1, $2, $3, $4, $5, 3, NOW() - ($6 || ' seconds')::interval)`,
            [id, type, JSON.stringify(payload), status, attempts, String(silentForSeconds)]
        );
        return id;
    }

    const statusOf = async (id: string) => (await pool.query('SELECT status FROM jobs WHERE id = $1', [id])).rows[0].status;

    it('requeues a job abandoned mid-run, and leaves a job with a recent heartbeat alone', async () => {
        const abandoned = await insertJob('EXTRACT_ENTITIES', { userId }, 'RUNNING', 1, 600);
        const alive = await insertJob('EXTRACT_ENTITIES', { userId }, 'RUNNING', 1, 600);
        await heartbeat(alive);

        await requeueStaleJobs();

        expect(await statusOf(abandoned)).toBe('PENDING');
        expect(await statusOf(alive)).toBe('RUNNING');
    });

    it('marks an abandoned ingestion on its last attempt DEAD and its document FAILED', async () => {
        const documentId = uuid();
        await pool.query(
            `INSERT INTO documents (id, workspace_id, user_id, title, file_type, file_size, storage_key, status)
             VALUES ($1, $2, $3, 'book.txt', 'text/plain', 10, 'k', 'PROCESSING')`,
            [documentId, workspaceId, userId]
        );
        const job = await insertJob('INGEST_DOCUMENT', { documentId, userId }, 'RUNNING', 3, 600);

        await requeueStaleJobs();

        expect(await statusOf(job)).toBe('DEAD');
        const doc = await pool.query('SELECT status, status_detail FROM documents WHERE id = $1', [documentId]);
        expect(doc.rows[0].status).toBe('FAILED');
        expect(doc.rows[0].status_detail).toMatch(/interrupted/);
    });

    it('backs off a failed job by tens of seconds before the next attempt', async () => {
        const id = await insertJob('EXTRACT_ENTITIES', { userId }, 'RUNNING', 1, 0);

        await markFailed({ id, type: 'EXTRACT_ENTITIES', payload: { userId }, attempts: 1, max_attempts: 3 }, 'provider unavailable');

        const { rows } = await pool.query(`SELECT status, EXTRACT(EPOCH FROM run_after - NOW()) AS wait FROM jobs WHERE id = $1`, [id]);
        expect(rows[0].status).toBe('PENDING');
        expect(Number(rows[0].wait)).toBeGreaterThan(15);
    });
});
