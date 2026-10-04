import { pipeline, env } from '@xenova/transformers';

// Disable local model loading, use remote models
env.allowLocalModels = false;

/**
 * Local ONNX embedding model (all-MiniLM-L6-v2, 384-dim). Runs on CPU with no
 * API key and no quota, so retrieval never depends on an external provider's
 * availability — only generation goes through the LLM router.
 */
class EmbeddingService {
    private embedder: any = null;
    private loadingPromise: Promise<any> | null = null;
    private modelName = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';

    /**
     * Caches the in-flight load, not just the resolved model: without this,
     * concurrent callers (e.g. two ingestion jobs running in parallel under
     * the worker pool) would each see `embedder` still unset and each start
     * its own duplicate model download/load.
     */
    async initialize() {
        if (this.embedder) return;
        if (!this.loadingPromise) {
            console.log('Loading embedding model:', this.modelName);
            this.loadingPromise = pipeline('feature-extraction', this.modelName).then(
                (model) => {
                    this.embedder = model;
                    console.log('Embedding model loaded successfully');
                    return model;
                },
                (err) => {
                    // Don't cache a failed load (e.g. transient download error) — let the next caller retry.
                    this.loadingPromise = null;
                    throw err;
                }
            );
        }
        await this.loadingPromise;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        await this.initialize();

        try {
            const output = await this.embedder(text, {
                pooling: 'mean',
                normalize: true,
            });

            // Convert to regular array
            const embedding = Array.from(output.data) as number[];
            return embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw new Error('Failed to generate embedding');
        }
    }

    /**
     * Embeds texts one at a time. Deliberately not a batched forward pass:
     * with @xenova/transformers on CPU, padded batches measured ~5x slower
     * than sequential calls and shifted the vectors (padding leaks into the
     * quantized model's output), so sequential is both faster and exact.
     */
    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        await this.initialize();

        const embeddings: number[][] = [];
        for (const text of texts) {
            embeddings.push(await this.generateEmbedding(text));
            // Let queued HTTP requests run between chunks: the API shares this process
            // with ingestion, and a long book must not freeze it.
            await new Promise((resolve) => setImmediate(resolve));
        }
        return embeddings;
    }
}

export const embeddingService = new EmbeddingService();
