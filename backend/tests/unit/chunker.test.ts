import { Chunker } from '../../src/chunking/chunker';

// Deterministic stand-in for the ONNX embedding model: same "topic" keyword ->
// identical vector, different keyword -> orthogonal vector. This lets the
// semantic-refinement pass (FR04 step 2) be tested without loading a real
// model or downloading weights.
jest.mock('../../src/llm/embeddings', () => ({
    embeddingService: {
        generateEmbedding: jest.fn(async (text: string) => {
            if (/cat/i.test(text)) return [1, 0, 0];
            if (/server/i.test(text)) return [0, 1, 0];
            return [0, 0, 1];
        }),
    },
}));

describe('Chunker', () => {
    it('packs consecutive short paragraphs into one chunk while they fit under chunkSize', async () => {
        const chunker = new Chunker(1800, 0, 0.45);
        const text = 'Paragraph one is short.\n\nParagraph two is also short.';
        const chunks = await chunker.chunk(text);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toBe('Paragraph one is short.\n\nParagraph two is also short.');
    });

    it('starts a new chunk once the next paragraph would exceed chunkSize', async () => {
        const chunker = new Chunker(30, 0, 0.45);
        const text = 'Paragraph one is short.\n\nParagraph two is also short.';
        const chunks = await chunker.chunk(text);
        expect(chunks.map((c) => c.text)).toEqual(['Paragraph one is short.', 'Paragraph two is also short.']);
    });

    it('refines a structural chunk at a semantic boundary between topics', async () => {
        const chunker = new Chunker(1800, 0, 0.45);
        const text =
            'The cat sat on the mat. The cat chased a mouse. The cat slept all day. ' +
            'The server crashed at noon. The server logs showed errors. The admin restarted the server.';

        const chunks = await chunker.chunk(text);

        expect(chunks).toHaveLength(2);
        expect(chunks[0].text).toMatch(/cat/i);
        expect(chunks[0].text).not.toMatch(/server/i);
        expect(chunks[1].text).toMatch(/server/i);
        expect(chunks[1].text).not.toMatch(/cat/i);
    });

    it('does not refine short structural chunks (fewer than 4 sentences)', async () => {
        const chunker = new Chunker(1800, 0, 0.45);
        const text = 'The cat sat down. The server crashed.';
        const chunks = await chunker.chunk(text);
        expect(chunks).toHaveLength(1);
    });

    it('carries overlap text into the next chunk when a paragraph is split by sentence', async () => {
        const chunker = new Chunker(40, 10, 0.45);
        const text = 'Sentence one is here. Sentence two follows here. Sentence three is last here.';
        const chunks = await chunker.chunk(text);
        expect(chunks.length).toBeGreaterThan(1);
        const tailOfFirst = chunks[0].text.slice(-10);
        expect(chunks[1].text).toContain(tailOfFirst);
    });
});
