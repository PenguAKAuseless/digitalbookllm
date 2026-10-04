import { tokenize } from './text';

/**
 * Okapi BM25 over a fixed set of chunk texts. Complements the embedding
 * search: exact names, numbers and rare terms are where a 384-dim sentence
 * embedding is weakest, and where keyword matching is strongest.
 */
export class BM25Index {
    private termFreqs: Array<Map<string, number>>;
    private lengths: number[];
    private docFreq = new Map<string, number>();
    private avgLength: number;

    constructor(texts: string[], private k1 = 1.2, private b = 0.75) {
        this.termFreqs = texts.map((text) => {
            const tf = new Map<string, number>();
            for (const token of tokenize(text)) tf.set(token, (tf.get(token) ?? 0) + 1);
            return tf;
        });
        this.lengths = this.termFreqs.map((tf) => [...tf.values()].reduce((s, n) => s + n, 0));
        this.avgLength = this.lengths.reduce((s, n) => s + n, 0) / Math.max(1, texts.length);
        for (const tf of this.termFreqs) for (const term of tf.keys()) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    /** Indices of the best-matching texts, best first; texts sharing no term with the query are left out. */
    search(query: string, limit: number): Array<{ index: number; score: number }> {
        const terms = [...new Set(tokenize(query))];
        const n = this.termFreqs.length;
        const scored: Array<{ index: number; score: number }> = [];
        this.termFreqs.forEach((tf, index) => {
            let score = 0;
            for (const term of terms) {
                const f = tf.get(term);
                if (!f) continue;
                const df = this.docFreq.get(term)!;
                const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
                score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lengths[index]) / this.avgLength));
            }
            if (score > 0) scored.push({ index, score });
        });
        return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    }
}
