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
            this.loadingPromise = pipeline('feature-extraction', this.modelName).then((model) => {
                this.embedder = model;
                console.log('Embedding model loaded successfully');
                return model;
            });
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

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        await this.initialize();

        const embeddings: number[][] = [];
        for (const text of texts) {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
        }
        return embeddings;
    }
}

export const embeddingService = new EmbeddingService();
