import { claimNext, markDone, markFailed, Job, JobType } from './jobQueue';

export type JobHandler = (job: Job) => Promise<void>;

/**
 * Bounded-concurrency poller: each slot loops claim -> handle -> claim, so at
 * most `concurrency` jobs run at once regardless of how many are enqueued
 * (the back-pressure mechanism required by NFR02.2). Idle slots poll on
 * `pollIntervalMs`.
 */
export class WorkerPool {
    private handlers = new Map<JobType, JobHandler>();
    private running = false;

    constructor(private concurrency = 2, private pollIntervalMs = 1500) {}

    register(type: JobType, handler: JobHandler): void {
        this.handlers.set(type, handler);
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        for (let i = 0; i < this.concurrency; i++) {
            this.loop();
        }
    }

    stop(): void {
        this.running = false;
    }

    private async loop(): Promise<void> {
        while (this.running) {
            const job = await claimNext().catch((err) => {
                console.error('[worker] claim failed:', err);
                return null;
            });

            if (!job) {
                await sleep(this.pollIntervalMs);
                continue;
            }

            const handler = this.handlers.get(job.type as JobType);
            if (!handler) {
                await markFailed(job, `No handler registered for job type ${job.type}`);
                continue;
            }

            try {
                await handler(job);
                await markDone(job.id);
            } catch (err: any) {
                console.error(`[worker] job ${job.id} (${job.type}) failed:`, err?.message || err);
                await markFailed(job, err?.message || String(err));
            }
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
