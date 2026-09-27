import { agent, registerUser, closePool, describeIfDb } from '../helpers/testApp';

/** UC01-UC04, FR01, FR02. */
describeIfDb('Auth and workspace lifecycle', () => {
    afterAll(async () => {
        await closePool();
    });

    it('rejects registration with a short password', async () => {
        const res = await agent.post('/api/auth/register').send({ email: `short-${Date.now()}@test.com`, password: '123' });
        expect(res.status).toBe(400);
    });

    it('rejects registration with a malformed email', async () => {
        const res = await agent.post('/api/auth/register').send({ email: 'not-an-email', password: 'password123' });
        expect(res.status).toBe(400);
    });

    it('registers, logs in, and resolves /me from the token', async () => {
        const { token, email } = await registerUser();

        const login = await agent.post('/api/auth/login').send({ email, password: 'password123' });
        expect(login.status).toBe(200);
        expect(login.body.data.token).toBeTruthy();

        const me = await agent.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
        expect(me.status).toBe(200);
        expect(me.body.data.user.email).toBe(email);
    });

    it('rejects login with the wrong password', async () => {
        const { email } = await registerUser();
        const res = await agent.post('/api/auth/login').send({ email, password: 'wrong-password' });
        expect(res.status).toBe(401);
    });

    it('creates, lists, updates, and deletes a workspace (UC04)', async () => {
        const { token } = await registerUser();

        const create = await agent.post('/api/workspaces').set('Authorization', `Bearer ${token}`).send({ name: 'Books' });
        expect(create.status).toBe(201);
        const workspaceId = create.body.data.id;

        const list = await agent.get('/api/workspaces').set('Authorization', `Bearer ${token}`);
        expect(list.body.data.some((w: { id: string }) => w.id === workspaceId)).toBe(true);

        const update = await agent
            .put(`/api/workspaces/${workspaceId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Renamed' });
        expect(update.body.data.name).toBe('Renamed');

        const del = await agent.delete(`/api/workspaces/${workspaceId}`).set('Authorization', `Bearer ${token}`);
        expect(del.status).toBe(200);

        const getAfterDelete = await agent.get(`/api/workspaces/${workspaceId}`).set('Authorization', `Bearer ${token}`);
        expect(getAfterDelete.status).toBe(404);
    });
});
