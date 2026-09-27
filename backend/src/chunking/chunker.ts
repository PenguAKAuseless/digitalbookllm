import { embeddingService } from '../llm/embeddings';

export interface TextChunk {
    text: string;
    /** Character offset into the page's text; used to resolve page_number. */
    startOffset: number;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/**
 * Two-level chunking pipeline (FR04):
 *
 *  1. Structural split — RecursiveCharacterTextSplitter-style: try paragraph
 *     breaks first, then sentence breaks, then hard word wrapping, always
 *     respecting `chunkSize` (chars) with `chunkOverlap` carried into the
 *     next chunk.
 *  2. Semantic refinement — inside any structural chunk long enough to span
 *     multiple sentences, adjacent sentences are embedded and split further
 *     wherever the cosine distance between them exceeds `semanticThreshold`
 *     (the author has moved to a new idea).
 */
export class Chunker {
    constructor(
        private chunkSize = parseInt(process.env.CHUNK_SIZE_CHARS || '1800'),
        private chunkOverlap = parseInt(process.env.CHUNK_OVERLAP_CHARS || '200'),
        private semanticThreshold = parseFloat(process.env.SEMANTIC_CHUNK_THRESHOLD || '0.45')
    ) {}

    /** Step 1: structural split by paragraph -> sentence -> word, with overlap. */
    private structuralSplit(text: string): TextChunk[] {
        const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
        const chunks: TextChunk[] = [];
        let cursor = 0;
        let buffer = '';
        let bufferStart = 0;

        const flush = () => {
            if (buffer.trim().length > 0) {
                chunks.push({ text: buffer.trim(), startOffset: bufferStart });
            }
            buffer = '';
        };

        for (const paragraph of paragraphs) {
            const paragraphStart = text.indexOf(paragraph, cursor);
            cursor = paragraphStart + paragraph.length;

            if (buffer.length === 0) bufferStart = paragraphStart;

            if (buffer.length + paragraph.length <= this.chunkSize) {
                buffer += (buffer ? '\n\n' : '') + paragraph;
                continue;
            }

            // Paragraph doesn't fit — flush what we have, then split this
            // paragraph by sentence if it alone exceeds chunkSize.
            flush();
            if (paragraph.length <= this.chunkSize) {
                buffer = paragraph;
                bufferStart = paragraphStart;
            } else {
                chunks.push(...this.splitBySentence(paragraph, paragraphStart));
            }
        }
        flush();

        return this.applyOverlap(chunks);
    }

    private splitBySentence(text: string, baseOffset: number): TextChunk[] {
        const sentences = text.split(SENTENCE_SPLIT);
        const chunks: TextChunk[] = [];
        let buffer = '';
        let offset = 0;
        let bufferStart = baseOffset;

        for (const sentence of sentences) {
            if (buffer.length === 0) bufferStart = baseOffset + offset;
            if (buffer.length + sentence.length <= this.chunkSize) {
                buffer += (buffer ? ' ' : '') + sentence;
            } else {
                if (buffer.trim()) chunks.push({ text: buffer.trim(), startOffset: bufferStart });
                buffer = sentence.slice(0, this.chunkSize); // hard wrap on pathological single sentence
            }
            offset += sentence.length + 1;
        }
        if (buffer.trim()) chunks.push({ text: buffer.trim(), startOffset: bufferStart });
        return chunks;
    }

    private applyOverlap(chunks: TextChunk[]): TextChunk[] {
        if (this.chunkOverlap <= 0) return chunks;
        return chunks.map((chunk, i) => {
            if (i === 0) return chunk;
            const prevTail = chunks[i - 1].text.slice(-this.chunkOverlap);
            return { ...chunk, text: `${prevTail} ${chunk.text}` };
        });
    }

    /** Step 2: refine structural chunks that span multiple distinct ideas. */
    private async semanticRefine(chunks: TextChunk[]): Promise<TextChunk[]> {
        const sentencesPerChunk = chunks.map((chunk) => {
            const sentences = chunk.text.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);
            return sentences.length < 4 ? null : sentences;
        });

        const allSentences = sentencesPerChunk.flatMap((s) => s ?? []);
        const allEmbeddings = await embeddingService.generateEmbeddings(allSentences);

        const refined: TextChunk[] = [];
        let cursor = 0;

        chunks.forEach((chunk, c) => {
            const sentences = sentencesPerChunk[c];
            if (!sentences) {
                refined.push(chunk);
                return;
            }

            const embeddings = allEmbeddings.slice(cursor, cursor + sentences.length);
            cursor += sentences.length;

            let group: string[] = [sentences[0]];
            let offset = chunk.startOffset;
            let groupStart = offset;

            for (let i = 1; i < sentences.length; i++) {
                const distance = 1 - cosineSimilarity(embeddings[i - 1], embeddings[i]);
                if (distance > this.semanticThreshold) {
                    refined.push({ text: group.join(' ').trim(), startOffset: groupStart });
                    group = [];
                    groupStart = offset;
                }
                group.push(sentences[i]);
                offset += sentences[i].length + 1;
            }
            if (group.length) refined.push({ text: group.join(' ').trim(), startOffset: groupStart });
        });

        return refined.filter((c) => c.text.length > 0);
    }

    async chunk(text: string): Promise<TextChunk[]> {
        const structural = this.structuralSplit(text);
        return this.semanticRefine(structural);
    }
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const chunker = new Chunker();
