import { agent, registerUser, createWorkspace, closePool, describeIfDb } from '../helpers/testApp';

/** UC10, UC11, FR01 (tenant isolation on highlights). */
describeIfDb('Highlights and bookmarks', () => {
    let token: string;
    let otherToken: string;
    let documentId: string;

    beforeAll(async () => {
        const user = await registerUser();
        token = user.token;
        const other = await registerUser();
        otherToken = other.token;

        const workspace = await createWorkspace(token);
        const upload = await agent
            .post('/api/documents/upload')
            .set('Authorization', `Bearer ${token}`)
            .field('workspaceId', workspace.id)
            .attach('file', Buffer.from('Chapter one. Chapter two. Chapter three.'), 'book.txt');

        expect(upload.status).toBe(202);
        documentId = upload.body.data.documentId;
    });

    afterAll(async () => {
        await closePool();
    });

    it('creates a highlight with normalized location metadata', async () => {
        const res = await agent
            .post(`/api/documents/${documentId}/highlights`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                type: 'HIGHLIGHT',
                content: 'Chapter one.',
                color: 'yellow',
                locationMeta: { page: 1, rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.02 }] },
            });

        expect(res.status).toBe(201);
        expect(res.body.data.location_meta.page).toBe(1);
    });

    it('creates a bookmark without content', async () => {
        const res = await agent
            .post(`/api/documents/${documentId}/highlights`)
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'BOOKMARK', locationMeta: { page: 2, rects: [] } });

        expect(res.status).toBe(201);
        expect(res.body.data.type).toBe('BOOKMARK');
    });

    it('rejects a highlight with an invalid type', async () => {
        const res = await agent
            .post(`/api/documents/${documentId}/highlights`)
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'INVALID', locationMeta: { page: 1, rects: [] } });
        expect(res.status).toBe(400);
    });

    it('lists highlights for the owning user only', async () => {
        const res = await agent.get(`/api/documents/${documentId}/highlights`).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('denies another user from listing or creating highlights on this document (IDOR)', async () => {
        const list = await agent.get(`/api/documents/${documentId}/highlights`).set('Authorization', `Bearer ${otherToken}`);
        expect([403, 404]).toContain(list.status);

        const create = await agent
            .post(`/api/documents/${documentId}/highlights`)
            .set('Authorization', `Bearer ${otherToken}`)
            .send({ type: 'BOOKMARK', locationMeta: { page: 1, rects: [] } });
        expect([403, 404]).toContain(create.status);
    });

    it('deletes a highlight', async () => {
        const created = await agent
            .post(`/api/documents/${documentId}/highlights`)
            .set('Authorization', `Bearer ${token}`)
            .send({ type: 'BOOKMARK', locationMeta: { page: 3, rects: [] } });

        const del = await agent
            .delete(`/api/documents/${documentId}/highlights/${created.body.data.id}`)
            .set('Authorization', `Bearer ${token}`);
        expect(del.status).toBe(200);
    });
});
