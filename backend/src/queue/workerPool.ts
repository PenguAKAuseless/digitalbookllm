import { claimNext, heartbeat, HEARTBEAT_MS, markDone, markFailed, requeueStaleJobs, Job, JobType } from './jobQueue';

export type JobHandler = (job: Job) => Promise<void>;

/** How often the pool looks for jobs abandoned by a worker that stopped mid-job. */
const STALE_SWEEP_MS = 60_000;
/** Pause after a queue-level failure (e.g. the database is unreachable) before polling again. */
const ERROR_BACKOFF_MS = 5_000;

/**
 * Bounded-concurrency poller: each slot loops claim -> handle -> claim, so at
 * most `concurrency` jobs run at once regardless of how many are enqueued
 * (the back-pressure mechanism required by NFR02.2). Idle slots poll on
 * `pollIntervalMs`.
 *
 * Recovery: a running job sends a heartbeat, and jobs left RUNNING by a
 * process that died are returned to the queue by a periodic sweep. A database
 * error never ends a slot's loop; the slot backs off and polls again.
 */
export class WorkerPool {
    private handlers = new Map<JobType, JobHandler>();
    private running = false;
    private sweepTimer?: NodeJS.Timeout;

    constructor(private concurrency = 2, private pollIntervalMs = 1500) {}

    register(type: JobType, handler: JobHandler): void {
        this.handlers.set(type, handler);
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.sweep();
        this.sweepTimer = setInterval(() => this.sweep(), STALE_SWEEP_MS);
        this.sweepTimer.unref();
        for (let i = 0; i < this.concurrency; i++) {
            this.loop();
        }
    }

    stop(): void {
        this.running = false;
        if (this.sweepTimer) clearInterval(this.sweepTimer);
    }

    private sweep(): void {
        requeueStaleJobs()
            .then((n) => n > 0 && console.warn(`[worker] requeued ${n} job(s) abandoned by a stopped worker`))
            .catch((err) => console.error('[worker] stale-job sweep failed:', err?.message || err));
    }

    private async loop(): Promise<void> {
        while (this.running) {
            try {
                const job = await claimNext();
                if (!job) {
                    await sleep(this.pollIntervalMs);
                    continue;
                }
                await this.run(job);
            } catch (err: any) {
                console.error('[worker] queue error:', err?.message || err);
                await sleep(ERROR_BACKOFF_MS);
            }
        }
    }

    private async run(job: Job): Promise<void> {
        const handler = this.handlers.get(job.type as JobType);
        if (!handler) {
            await markFailed(job, `No handler registered for job type ${job.type}`);
            return;
        }

        const beat = setInterval(() => {
            heartbeat(job.id).catch((err) => console.error(`[worker] heartbeat for ${job.id} failed:`, err?.message || err));
        }, HEARTBEAT_MS);
        try {
            await handler(job);
            await markDone(job.id);
        } catch (err: any) {
            console.error(`[worker] job ${job.id} (${job.type}) failed:`, err?.message || err);
            await markFailed(job, err?.message || String(err));
        } finally {
            clearInterval(beat);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
