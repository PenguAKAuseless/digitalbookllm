/**
 * Knowledge-graph ablation for the RAG query path (report question: "does the
 * KG influence retrieval or generation?").
 *
 * Runs the real ragController.queryStream -> VectorRetrievalService ->
 * hybridRetrieve -> LLMRouter prompt builder twice on a two-hop question in
 * the style of HotpotQA ("where is the director of <film> based?"), asked
 * while reading volume 2 of a series: once with the user's knowledge graph
 * populated, once with it empty. The passage that answers the question (the
 * director's biography) is in volume 1, read earlier, and shares no keyword
 * with the question, so only the graph edge film -> director, learned from
 * volume 2, can bring it into the answer. Only the database driver, the
 * embedding model and the HTTP transport are stubbed.
 */
const mockSql: string[] = [];
let mockKgPopulated = true;

const QUESTION = 'Where is the director of the film Big Stone Gap based?';
const FILM = 'Big Stone Gap is a 2014 American drama film directed by Adriana Trigiani, set in a small Virginia town.';
const BRIDGE = 'Adriana Trigiani is an Italian American author and filmmaker who lives in Greenwich Village, New York City.';
const DISTRACTORS = Array.from(
    { length: 8 },
    (_, i) => `Big Stone Gap distractor ${i}: the town of Big Stone Gap, Virginia, is where director number ${i} of a local theatre was based.`
);
/** Volume 2 (being read) holds the film passage and distractors; volume 1 (read earlier) holds the biography. */
const VOLUME_2 = [{ id: 'film', text: FILM }, ...DISTRACTORS.map((text, i) => ({ id: `d${i}`, text }))].map((c) => ({
    ...c, page_number: 1, document_id: 'vol2', document_name: 'Volume 2',
}));
/** Volume 1 also holds look-alike passages, so searching earlier books with the plain question finds those instead. */
const VOLUME_1_LOOKALIKES = Array.from(
    { length: 3 },
    (_, i) => `Where is the director based? In Big Stone Gap, director ${i} of the film society is based near the gap in the stone hills.`
);
const VOLUME_1 = [
    { id: 'bridge', text: BRIDGE, page_number: 7, document_id: 'vol1', document_name: 'Volume 1' },
    ...VOLUME_1_LOOKALIKES.map((text, i) => ({ id: `l${i}`, text, page_number: 2, document_id: 'vol1', document_name: 'Volume 1' })),
];
/** Dense ranking the stubbed pgvector returns within volume 2. */
const DENSE = VOLUME_2.map((c, rank) => ({ id: c.id, similarity: 0.8 - rank * 0.05 }));

jest.mock('../../src/db/config', () => ({
    pool: {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
            mockSql.push(sql.replace(/\s+/g, ' ').trim());
            if (/FROM entities WHERE user_id/.test(sql)) {
                return mockKgPopulated
                    ? { rows: [{ id: 'e1', name: 'Big Stone Gap', type: 'film' }, { id: 'e2', name: 'Adriana Trigiani', type: 'person' }] }
                    : { rows: [] };
            }
            if (/FROM entity_relations WHERE user_id/.test(sql)) {
                return mockKgPopulated ? { rows: [{ sourceId: 'e1', targetId: 'e2', type: 'directed by', documentId: 'vol2' }] } : { rows: [] };
            }
            if (sql.includes('SELECT id FROM documents WHERE workspace_id = $1 AND user_id')) return { rows: [{ id: 'vol1' }, { id: 'vol2' }] };
            if (sql.includes('ORDER BY c.embedding <=>')) return { rows: DENSE };
            // Document scope (param 'vol2') vs the workspace the graph reaches into (param 'w1').
            const scopeChunks = params[0] === 'w1' ? [...VOLUME_1, ...VOLUME_2] : VOLUME_2;
            if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: scopeChunks.length, latest: new Date(0) }] };
            if (sql.includes('SELECT c.id, c.text')) return { rows: scopeChunks };
            if (sql.includes('WHERE id = ANY')) {
                return { rows: (params[1] as string[]).map((id) => ({ id, similarity: DENSE.find((d) => d.id === id)?.similarity ?? 0.1 })) };
            }
            if (sql.includes('SELECT queries_today')) return { rows: [{ queries_today: 0 }], rowCount: 1 };
            if (sql.includes('COUNT(*)::int AS cnt')) return { rows: [{ cnt: 0 }], rowCount: 1 };
            return { rows: [{ id: 'row' }], rowCount: 1 };
        }),
    },
}));

jest.mock('../../src/llm/embeddings', () => ({
    embeddingService: { generateEmbedding: jest.fn(async () => [0.1, 0.2, 0.3]) },
}));

interface RunOutput {
    sql: string[];
    prompt: string;
    citations: Array<{ chunkId: string; documentId: string; documentName?: string; page: number | null }>;
    done: any;
}

async function runQuery(userId: string): Promise<RunOutput> {
    mockSql.length = 0;
    const llmBodies: any[] = [];
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
        llmBodies.push(JSON.parse(String(init?.body)));
        const sse = 'data: {"choices":[{"delta":{"content":"She lives in Greenwich Village, New York City [2][1]."}}]}\n\ndata: [DONE]\n\n';
        const bytes = new TextEncoder().encode(sse);
        let sent = false;
        return {
            ok: true,
            status: 200,
            body: { getReader: () => ({ read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })) }) },
        } as unknown as Response;
    }) as unknown as typeof fetch;

    const written: string[] = [];
    const res: any = {
        setHeader: () => undefined,
        flushHeaders: () => undefined,
        write: (chunk: string) => written.push(chunk),
        end: () => undefined,
        status: () => res,
        json: (body: unknown) => written.push(`event: json\ndata: ${JSON.stringify(body)}\n\n`),
    };
    const next = jest.fn();

    const { ragController } = require('../../src/controllers/ragController');
    await ragController.queryStream({ userId, body: { query: QUESTION, workspaceId: 'w1', documentId: 'vol2' } }, res, next);
    expect(next).not.toHaveBeenCalled();

    const events = written.join('').split('\n\n').filter(Boolean).map((raw) => ({
        event: raw.match(/^event: (.*)$/m)![1],
        data: JSON.parse(raw.match(/^data: (.*)$/m)![1]),
    }));
    return {
        sql: [...mockSql],
        prompt: llmBodies[0].messages.map((m: any) => m.content).join('\n'),
        citations: events.find((e) => e.event === 'citations')!.data,
        done: events.find((e) => e.event === 'done')!.data,
    };
}

beforeAll(() => {
    // Exactly one OpenAI-compatible provider, whose HTTP calls are captured above.
    for (const key of Object.keys(process.env)) if (/_API_KEY$|AZURE_OPENAI_ENDPOINT/.test(key)) delete process.env[key];
    process.env.GROQ_API_KEY = 'test-key';
});

describe('RAG query path with the knowledge graph on vs off', () => {
    let kgOn: RunOutput;
    let kgOff: RunOutput;

    beforeAll(async () => {
        // Different users, so the per-user graph cache cannot carry one run's graph into the other.
        mockKgPopulated = true;
        kgOn = await runQuery('user-kg-on');
        mockKgPopulated = false;
        kgOff = await runQuery('user-kg-off');
    });

    it('reads the knowledge graph while retrieving, before generating', () => {
        const kgReads = kgOn.sql.filter((s) => /FROM (entities|entity_relations) WHERE user_id/.test(s));
        expect(kgReads).toHaveLength(2);
    });

    it("retrieves the earlier volume's passage only through the graph edge, citing that volume", () => {
        const bridge = kgOn.citations.find((c) => c.chunkId === 'bridge');
        expect(bridge).toMatchObject({ documentId: 'vol1', documentName: 'Volume 1', page: 7 });
        expect(kgOff.citations.map((c) => c.chunkId)).not.toContain('bridge');
        // Passages of the book being read carry no book name.
        const film = kgOn.citations.find((c) => c.chunkId === 'film')!;
        expect(film.documentId).toBe('vol2');
        expect(film.documentName).toBeUndefined();
        expect(kgOn.citations).toHaveLength(5);
        expect(kgOff.citations).toHaveLength(5);
    });

    it('gives the LLM the graph relation as structured context', () => {
        expect(kgOn.prompt).toContain('Big Stone Gap — directed by → Adriana Trigiani');
        expect(kgOff.prompt).not.toMatch(/Knowledge graph/);
    });

    it('reports which passages the answer cites', () => {
        expect(kgOn.done.citedIndices).toEqual([1, 2]);
    });
});
