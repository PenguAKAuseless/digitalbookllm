import { describeIfDb, registerUser, closePool } from '../helpers/testApp';
import { pool } from '../../src/db/config';
import { llmRouter } from '../../src/llm/router';
import { handleExtractEntities } from '../../src/queue/handlers/extractEntities';
import type { Job } from '../../src/queue/jobQueue';

/**
 * UC15: the extraction worker must persist relations in real PostgreSQL.
 * Regression: the relation insert once failed on every call with
 * "inconsistent types deduced for parameter $2", so graphs had nodes but no edges.
 */
describeIfDb('Knowledge graph extraction persists to PostgreSQL', () => {
    const passage =
        'Shirley Temple starred as Corliss Archer in the film Kiss and Tell. ' +
        'Shirley Temple later served as Chief of Protocol of the United States.';
    const llmOutput = JSON.stringify({
        entities: [
            { name: 'Shirley Temple', type: 'person', description: 'American actress and diplomat' },
            { name: 'Kiss and Tell', type: 'film', description: '1945 comedy film' },
            { name: 'Chief of Protocol', type: 'position', description: 'US diplomatic office' },
        ],
        relations: [
            { source: 'Shirley Temple', target: 'Kiss and Tell', type: 'starred in', evidence: 'Shirley Temple starred as Corliss Archer' },
            { source: 'Shirley Temple', target: 'Chief of Protocol', type: 'served as', evidence: 'served as Chief of Protocol' },
        ],
    });
    let userId: string;

    const job = (): Job => ({ id: 'test', type: 'EXTRACT_ENTITIES', payload: { userId, text: passage }, attempts: 0, max_attempts: 1 });

    beforeAll(async () => {
        userId = (await registerUser()).userId;
        jest.spyOn(llmRouter, 'generate').mockResolvedValue({ text: llmOutput, provider: 'mock' } as any);
    });

    afterAll(async () => {
        jest.restoreAllMocks();
        await closePool();
    });

    it('stores entities and relations, and re-running adds no duplicates', async () => {
        await handleExtractEntities(job());
        await handleExtractEntities(job());

        const entities = await pool.query('SELECT name FROM entities WHERE user_id = $1 ORDER BY name', [userId]);
        const relations = await pool.query('SELECT relation_type, excerpt FROM entity_relations WHERE user_id = $1 ORDER BY relation_type', [userId]);

        expect(entities.rows.map((r) => r.name)).toEqual(['Chief of Protocol', 'Kiss and Tell', 'Shirley Temple']);
        expect(relations.rows.map((r) => r.relation_type)).toEqual(['served as', 'starred in']);
        expect(relations.rows[1].excerpt).toContain('Shirley Temple starred as Corliss Archer');
    });
});
