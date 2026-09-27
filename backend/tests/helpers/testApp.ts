import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/config';

export const app = createApp();
export const agent = request(app);

/** True when a database is reachable — integration suites skip themselves otherwise. */
export async function hasDatabase(): Promise<boolean> {
    try {
        const client = await pool.connect();
        client.release();
        return true;
    } catch {
        return false;
    }
}

let counter = 0;

/** Registers a fresh user and returns its bearer token, for tests that need an authenticated identity. */
export async function registerUser(): Promise<{ token: string; email: string; userId: string }> {
    counter += 1;
    const email = `test-user-${Date.now()}-${counter}@example.com`;
    const res = await agent.post('/api/auth/register').send({ email, password: 'password123' });
    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { token: res.body.data.token, email, userId: res.body.data.user.id };
}

export async function createWorkspace(token: string, name = 'Test Workspace') {
    const res = await agent.post('/api/workspaces').set('Authorization', `Bearer ${token}`).send({ name });
    return res.body.data;
}

export async function closePool() {
    await pool.end();
}

/**
 * Integration suites need a real Postgres with the schema applied (see
 * docs/deployment.md → "Running the tests"). Gate on env presence so CI
 * environments without a database skip cleanly instead of failing on every
 * test individually.
 */
export const describeIfDb = process.env.DATABASE_URL || process.env.DB_HOST ? describe : describe.skip;

