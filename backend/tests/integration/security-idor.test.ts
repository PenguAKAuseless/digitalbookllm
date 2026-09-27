import { agent, registerUser, createWorkspace, closePool, describeIfDb } from '../helpers/testApp';

/**
 * NFR04.1 (IDOR prevention): user A must never be able to read, modify, or
 * delete user B's workspaces, documents, or highlights via a guessed/leaked id.
 * Maps to TC-SEC-01 in docs/test-scenarios.md.
 */
describeIfDb('IDOR protection across tenant-scoped resources', () => {
    let userA: Awaited<ReturnType<typeof registerUser>>;
    let userB: Awaited<ReturnType<typeof registerUser>>;
    let workspaceA: { id: string };

    beforeAll(async () => {
        userA = await registerUser();
        userB = await registerUser();
        workspaceA = await createWorkspace(userA.token, 'Workspace A');
    });

    afterAll(async () => {
        await closePool();
    });

    it('denies user B reading user A workspace', async () => {
        const res = await agent.get(`/api/workspaces/${workspaceA.id}`).set('Authorization', `Bearer ${userB.token}`);
        expect([403, 404]).toContain(res.status);
    });

    it('denies user B updating user A workspace', async () => {
        const res = await agent
            .put(`/api/workspaces/${workspaceA.id}`)
            .set('Authorization', `Bearer ${userB.token}`)
            .send({ name: 'hijacked' });
        expect([403, 404]).toContain(res.status);
    });

    it('denies user B deleting user A workspace', async () => {
        const res = await agent.delete(`/api/workspaces/${workspaceA.id}`).set('Authorization', `Bearer ${userB.token}`);
        expect([403, 404]).toContain(res.status);
    });

    it('denies user B listing documents in user A workspace', async () => {
        const res = await agent
            .get(`/api/documents?workspaceId=${workspaceA.id}`)
            .set('Authorization', `Bearer ${userB.token}`);
        expect([403, 404]).toContain(res.status);
    });

    it('rejects any request without a bearer token', async () => {
        const res = await agent.get(`/api/workspaces/${workspaceA.id}`);
        expect(res.status).toBe(401);
    });

    it('rejects a request with a malformed token', async () => {
        const res = await agent.get('/api/workspaces').set('Authorization', 'Bearer not-a-real-jwt');
        expect(res.status).toBe(401);
    });
});
