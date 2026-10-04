/**
 * Weighted reciprocal-rank fusion (Cormack et al., SIGIR 2009). Combines
 * rankings whose scores are not comparable (cosine, BM25, graph weight) by
 * rank alone; k = 60 is the value from the original paper.
 */
export function reciprocalRankFusion<T extends string>(
    rankings: Array<{ ids: T[]; weight: number }>,
    k = 60
): Array<{ id: T; score: number }> {
    const scores = new Map<T, number>();
    for (const { ids, weight } of rankings) {
        ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank + 1)));
    }
    return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
