// Lightweight stand-in for @xenova/transformers (real package is ESM-only and
// unnecessary weight for API-level integration tests that never call
// generateEmbedding). Tests that exercise embeddings mock ../../src/llm/embeddings
// directly instead (see tests/unit/chunker.test.ts).
module.exports = {
    env: { allowLocalModels: true },
    pipeline: async () => {
        throw new Error('@xenova/transformers is stubbed out in tests; mock src/llm/embeddings instead.');
    },
};
