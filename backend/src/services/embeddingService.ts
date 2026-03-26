import { pipeline, env } from '@xenova/transformers';

// Disable local model loading, use remote models
env.allowLocalModels = false;

class EmbeddingService {
    private embedder: any = null;
    private modelName = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';

    async initialize() {
        if (!this.embedder) {
            console.log('Loading embedding model:', this.modelName);
            this.embedder = await pipeline('feature-extraction', this.modelName);
            console.log('Embedding model loaded successfully');
        }
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
