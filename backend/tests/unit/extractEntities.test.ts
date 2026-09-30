// In-memory stand-ins for Postgres and the LLM router, so the extraction flow
// can be exercised without a database or spending provider requests.
const mockQueries: Array<{ sql: string; params: unknown[] }> = [];
jest.mock('../../src/db/config', () => ({
    pool: {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
            mockQueries.push({ sql, params });
            if (sql.includes('SELECT full_text')) return { rows: [{ full_text: mockDocumentText }], rowCount: 1 };
            if (sql.includes('INSERT INTO entities')) return { rows: [{ id: `id:${String(params[2]).toLowerCase()}` }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        }),
    },
}));

const mockGenerate = jest.fn();
jest.mock('../../src/llm/router', () => ({ llmRouter: { generate: (...args: unknown[]) => mockGenerate(...args) } }));

let mockDocumentText = '';

import { handleExtractEntities, parseJsonObject, sampleWindows, splitIntoWindows } from '../../src/queue/handlers/extractEntities';
import { Job } from '../../src/queue/jobQueue';

const job = (payload: Record<string, unknown>): Job => ({ id: 'job', type: 'EXTRACT_ENTITIES', payload, attempts: 1, max_attempts: 3 });
const paragraph = (i: number) => `Paragraph ${i} talks about topic ${i} in some detail. `.repeat(20);

beforeEach(() => {
    mockQueries.length = 0;
    mockGenerate.mockReset();
});

describe('splitIntoWindows', () => {
    it('keeps every window under the size and prefers paragraph breaks', () => {
        const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join('\n\n');
        const windows = splitIntoWindows(text, 3000);
        expect(windows.length).toBeGreaterThan(1);
        for (const w of windows) expect(w.length).toBeLessThanOrEqual(3000);
        expect(windows[0].endsWith('detail.')).toBe(true);
    });
});

describe('sampleWindows', () => {
    it('spreads the budget across the whole text', () => {
        const windows = Array.from({ length: 20 }, (_, i) => `w${i}`);
        expect(sampleWindows(windows, 4)).toEqual(['w0', 'w5', 'w10', 'w15']);
        expect(sampleWindows(windows.slice(0, 3), 4)).toEqual(['w0', 'w1', 'w2']);
    });
});

describe('parseJsonObject', () => {
    it('accepts code fences and surrounding prose', () => {
        expect(parseJsonObject('Sure!\n```json\n{"entities":[]}\n```')).toEqual({ entities: [] });
    });
    it('returns null for truncated output instead of an empty graph', () => {
        expect(parseJsonObject('{"entities":[{"name":"A"')).toBeNull();
    });
});

describe('handleExtractEntities', () => {
    it('caps LLM requests per document and creates nodes for relation endpoints', async () => {
        mockDocumentText = Array.from({ length: 200 }, (_, i) => paragraph(i)).join('\n\n');
        mockGenerate.mockResolvedValue({
            provider: 'Mock',
            text: JSON.stringify({
                entities: [{ name: 'Alpha', type: 'concept', description: 'first' }],
                relations: [{ source: 'Alpha', target: 'Beta', type: 'relates to', evidence: 'Alpha relates to Beta' }],
            }),
        });

        await handleExtractEntities(job({ userId: 'u1', documentId: 'd1' }));

        expect(mockGenerate).toHaveBeenCalledTimes(6);
        const entityNames = mockQueries.filter((q) => q.sql.includes('INSERT INTO entities')).map((q) => q.params[2]);
        expect(entityNames).toContain('Beta');
        const relation = mockQueries.find((q) => q.sql.includes('INSERT INTO entity_relations'))!;
        expect(relation.params.slice(2, 7)).toEqual(['id:alpha', 'id:beta', 'relates to', 'd1', 'Alpha relates to Beta']);
    });

    it('stops after consecutive failures and fails the job so it is retried', async () => {
        mockDocumentText = Array.from({ length: 200 }, (_, i) => paragraph(i)).join('\n\n');
        mockGenerate.mockRejectedValue(new Error('HTTP 429'));

        await expect(handleExtractEntities(job({ userId: 'u1', documentId: 'd1' }))).rejects.toThrow('HTTP 429');
        expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('treats unparseable output as a failure rather than an empty result', async () => {
        mockGenerate.mockResolvedValue({ provider: 'Mock', text: '{"entities":[{"name":"A"' });

        await expect(handleExtractEntities(job({ userId: 'u1', text: paragraph(1) }))).rejects.toThrow('unparseable JSON');
    });
});
