/**
 * Post-deploy security probe (NFR04.1 / TC-SEC-01 family). Runs against a
 * live, already-deployed instance over plain HTTP — complements the
 * in-process IDOR suite in tests/integration/security-idor.test.ts, which
 * exercises the same guarantees at the Express-app level during CI.
 *
 * Usage: BASE_URL=https://api.example.com ts-node eval/security-probes.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

interface ProbeResult {
    name: string;
    passed: boolean;
    detail: string;
}

async function json(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
    });
    const body: any = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function registerProbeUser(label: string) {
    const email = `probe-${label}-${Date.now()}@example.com`;
    const { body } = await json('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'password123' }),
    });
    return body.data.token as string;
}

async function run(): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const tokenA = await registerProbeUser('a');
    const tokenB = await registerProbeUser('b');

    const ws = await json('/api/workspaces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ name: 'Probe Workspace' }),
    });
    const workspaceId = ws.body.data.id;

    const cases: Array<[string, () => Promise<{ status: number }>]> = [
        ['B cannot read A workspace', () => json(`/api/workspaces/${workspaceId}`, { headers: { Authorization: `Bearer ${tokenB}` } })],
        ['B cannot update A workspace', () => json(`/api/workspaces/${workspaceId}`, { method: 'PUT', headers: { Authorization: `Bearer ${tokenB}` }, body: JSON.stringify({ name: 'x' }) })],
        ['B cannot delete A workspace', () => json(`/api/workspaces/${workspaceId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` } })],
        ['B cannot list A documents', () => json(`/api/documents?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${tokenB}` } })],
        ['Unauthenticated request is rejected', () => json(`/api/workspaces/${workspaceId}`)],
        ['Malformed token is rejected', () => json('/api/workspaces', { headers: { Authorization: 'Bearer not-a-jwt' } })],
    ];

    for (const [name, probe] of cases) {
        const { status } = await probe();
        const expectedUnauth = name.includes('Unauthenticated') || name.includes('Malformed');
        const passed = expectedUnauth ? status === 401 : status === 403 || status === 404;
        results.push({ name, passed, detail: `HTTP ${status}` });
    }

    return results;
}

run().then((results) => {
    console.log('\nSecurity probe report\n' + '='.repeat(40));
    let failures = 0;
    for (const r of results) {
        console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
        if (!r.passed) failures++;
    }
    console.log('='.repeat(40));
    console.log(`${results.length - failures}/${results.length} probes passed`);
    process.exit(failures > 0 ? 1 : 0);
});
