/**
 * Load test for NFR02.2 (job queue under concurrent load) and a baseline
 * throughput check with autocannon. Maps to TC-PERF-01 in
 * docs/test-scenarios.md.
 *
 * Usage: BASE_URL=http://localhost:3001 ts-node eval/load-test.ts
 */
import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CONCURRENT_UPLOADS = parseInt(process.env.CONCURRENT_UPLOADS || '8');

async function json(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function setup() {
    const email = `loadtest-${Date.now()}@example.com`;
    const reg = await json('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) });
    const token = reg.body.data.token as string;
    const ws = await json('/api/workspaces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Load Test' }),
    });
    return { token, workspaceId: ws.body.data.id as string };
}

/** TC-PERF-01: N concurrent uploads must all be accepted (200/202), none should 500 or hang. */
async function concurrentUploadBurst(token: string, workspaceId: string) {
    const started = Date.now();

    const uploads = Array.from({ length: CONCURRENT_UPLOADS }, async (_, i) => {
        const form = new FormData();
        form.append('workspaceId', workspaceId);
        form.append('file', new Blob([`Load test document ${i}. `.repeat(50)], { type: 'text/plain' }), `doc-${i}.txt`);

        const res = await fetch(`${BASE_URL}/api/documents/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        });
        return res.status;
    });

    const statuses = await Promise.all(uploads);
    const elapsedMs = Date.now() - started;
    const accepted = statuses.filter((s) => s === 200 || s === 202).length;

    console.log(`\nConcurrent upload burst (n=${CONCURRENT_UPLOADS})`);
    console.log(`  accepted: ${accepted}/${CONCURRENT_UPLOADS}, elapsed: ${elapsedMs}ms`);
    console.log(`  status codes: ${JSON.stringify(statuses)}`);

    return accepted === CONCURRENT_UPLOADS;
}

async function baselineThroughput(token: string) {
    const result = await autocannon({
        url: `${BASE_URL}/api/workspaces`,
        connections: 10,
        duration: 5,
        headers: { Authorization: `Bearer ${token}` },
    });

    console.log('\nBaseline read throughput (GET /api/workspaces, 10 connections, 5s)');
    console.log(`  requests/sec: ${result.requests.average}`);
    console.log(`  latency p99: ${result.latency.p99}ms`);
    console.log(`  errors: ${result.errors}, timeouts: ${result.timeouts}`);

    return result.errors === 0;
}

async function main() {
    const { token, workspaceId } = await setup();
    const uploadOk = await concurrentUploadBurst(token, workspaceId);
    const throughputOk = await baselineThroughput(token);

    const passed = uploadOk && throughputOk;
    console.log(`\n${passed ? 'PASS' : 'FAIL'}: load test`);
    process.exit(passed ? 0 : 1);
}

main();
