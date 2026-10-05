import { BM25Index } from './bm25';
import { reciprocalRankFusion } from './fusion';
import { formatFacts, GraphEntity, GraphRelation, linkQueryEntities, relationFacts, selectHopEntities } from './graphSignals';
import { containsPhrase, normalizeText } from './text';

export interface CorpusChunk {
    id: string;
    text: string;
    page_number: number | null;
    document_id: string;
    document_name?: string;
}

/** Every chunk in the search scope (one document or a workspace), with its lexical index. Built once and cached. */
export class ScopeCorpus {
    readonly normTexts: string[];
    readonly bm25: BM25Index;
    readonly indexById: Map<string, number>;

    constructor(readonly chunks: CorpusChunk[]) {
        this.normTexts = chunks.map((c) => normalizeText(c.text));
        this.bm25 = new BM25Index(chunks.map((c) => c.text));
        this.indexById = new Map(chunks.map((c, i) => [c.id, i]));
    }
}

/** Data access for one retrieval scope; implemented over PostgreSQL in production and in memory by the evaluation. */
export interface RetrievalStore {
    /** Nearest chunks by embedding (pgvector cosine) within the scope, best first. */
    denseSearch(queryEmbedding: number[], limit: number): Promise<Array<{ id: string; similarity: number }>>;
    /** Cosine similarity for chunks that reached the result through another signal. */
    similarities(ids: string[], queryEmbedding: number[]): Promise<Map<string, number>>;
    corpus(): Promise<ScopeCorpus>;
    /** The user's knowledge graph: relations learned from every document in the workspace, and from chat. */
    graph(): Promise<{ entities: GraphEntity[]; relations: GraphRelation[] }>;
    /**
     * Where the graph-guided second pass searches: every book in the workspace
     * the user has read, so a link can lead to an earlier book. Defaults to the scope.
     */
    hopCorpus?(): Promise<ScopeCorpus>;
    /** Dense search over hopCorpus(). Defaults to denseSearch. */
    hopDenseSearch?(queryEmbedding: number[], limit: number): Promise<Array<{ id: string; similarity: number }>>;
}

export interface RetrievalOptions {
    topK: number;
    /** Candidates taken from each signal before fusion. */
    candidates?: number;
    lexical?: boolean;
    /** Knowledge-graph-guided second pass (and relation facts for the prompt). */
    graph?: boolean;
    /**
     * How the second pass over other books picks its passages:
     *   'plain'        the question as is (no graph);
     *   'graph'        one search per graph-chosen entity (name + question);
     *   'graph+plain'  'graph', then 'plain' for any slot left empty;
     *   'rerank'       'plain' candidates re-ranked by the graph: passages naming an entity the
     *                  graph links to the question move up (rank fusion of the two orders).
     */
    secondPass?: 'plain' | 'graph' | 'graph+plain' | 'rerank';
    /** Per-signal RRF weights. */
    weights?: { dense: number; lexical: number };
    /** Result slots the second pass may take (the first pass keeps the rest). */
    hopSlots?: number;
    /**
     * 'other-documents': the second pass only adds passages from books other than the one in
     * scope; 'any': also from the scope itself. Within one book the first pass already finds what
     * the second would, and a second-pass passage there only displaces a first-pass one.
     */
    hopScope?: 'other-documents' | 'any';
    /** Embeds the graph-guided second-pass queries; required for them. */
    embed?: (text: string) => Promise<number[]>;
    /**
     * Relation facts for the prompt: 'linked' keeps only relations joining an entity of a passage
     * from another book to an entity of the question or of the book in scope (the link that
     * explains why that passage is there), and none when no such passage was retrieved; 'all'
     * keeps every relation around the question's entities; 'none' gives no facts.
     */
    facts?: 'linked' | 'all' | 'none';
}

/** Chosen on the development splits (eval/experiments/tune-retrieval.ts), not on the reported test books. */
export const DEFAULT_WEIGHTS = { dense: 0.5, lexical: 1 };
/**
 * Second-pass settings, chosen on the development copies only (KG-Series dev from
 * HotpotQA train; eval/experiments/experiment-3-kg-series.ts with SERIES=dev, tune-graph.ts):
 * re-ranking by the graph with 3 slots gave the best evidence chain (90.0% vs 82.5%
 * for the same pass without the graph), and confining the pass to other books
 * left single-book recall unchanged (ViQuAD dev R@5 84.6%).
 */
export const DEFAULT_HOP_SLOTS = 3;
export const DEFAULT_HOP_SCOPE: 'other-documents' | 'any' = 'other-documents';
export const DEFAULT_SECOND_PASS: NonNullable<RetrievalOptions['secondPass']> = 'rerank';
export const DEFAULT_FACTS: NonNullable<RetrievalOptions['facts']> = 'linked';
/** First-pass passages whose entities can seed the graph hop. */
const HOP_CONTEXT = 2;

export interface RetrievalResult {
    chunks: Array<CorpusChunk & { similarity: number }>;
    /** Best dense similarity in the scope, used to decide whether the scope is relevant at all. */
    topSimilarity: number;
    /** Knowledge-graph relations behind the second pass, for the prompt. */
    graphFacts: string[];
    /** Entities the question names. */
    linkedEntities: string[];
    /** Bridge entities the graph led the second pass to. */
    hopEntities: string[];
}

const DEFAULT_CANDIDATES = 40;

function fusedSearch(
    corpus: ScopeCorpus,
    dense: Array<{ id: string }>,
    queryText: string,
    useLexical: boolean,
    weights: { dense: number; lexical: number },
    candidates: number
): string[] {
    const rankings = [{ ids: dense.map((d) => d.id), weight: weights.dense }];
    if (useLexical) rankings.push({ ids: corpus.bm25.search(queryText, candidates).map((h) => corpus.chunks[h.index].id), weight: weights.lexical });
    return reciprocalRankFusion(rankings).map((f) => f.id);
}

/**
 * Two-pass retrieval guided by the knowledge graph.
 *
 *   Pass 1  dense (pgvector) + BM25 over the scope (usually the book being
 *           read), fused by reciprocal rank.
 *   Graph   picks the entities to look up: those the question names, and the
 *           bridge entities one edge away from them or from the top first-pass
 *           passages, which the question does not name (selectHopEntities).
 *   Pass 2  for each, search again with the entity's name plus the question,
 *           over every book read so far, keeping the best passage that names
 *           the entity and is not already in the result. Slots the graph leaves
 *           empty can go to the plain question searched the same way.
 *
 * Plain retrieval can only find passages that resemble the question; the
 * graph points the second pass at the entities the answer depends on - the
 * second step of a multi-hop question, possibly in a book read earlier - and
 * the relations that justify it go to the LLM as facts.
 */
export async function hybridRetrieve(
    store: RetrievalStore,
    queryText: string,
    queryEmbedding: number[],
    options: RetrievalOptions
): Promise<RetrievalResult> {
    const candidates = options.candidates ?? DEFAULT_CANDIDATES;
    const useLexical = options.lexical ?? true;
    const weights = options.weights ?? DEFAULT_WEIGHTS;
    const useGraph = (options.graph ?? true) && options.embed !== undefined;
    // No graph and no explicit mode: a single pass, as before this change.
    const mode = options.secondPass ?? (useGraph ? DEFAULT_SECOND_PASS : undefined);
    const usePlain = mode !== undefined && mode !== 'graph';
    const slots = Math.min(options.hopSlots ?? DEFAULT_HOP_SLOTS, options.topK);

    const [dense, corpus] = await Promise.all([store.denseSearch(queryEmbedding, candidates), store.corpus()]);
    const similarity = new Map(dense.map((d) => [d.id, d.similarity]));
    const firstPass = fusedSearch(corpus, dense, queryText, useLexical, weights, candidates);

    let graphFacts: string[] = [];
    let linkedEntities: string[] = [];
    const hopEntities: string[] = [];
    const secondPass: string[] = [];
    let hopCorpus: ScopeCorpus | null = null;
    let graphEntities: GraphEntity[] = [];
    let graphRelations: GraphRelation[] = [];

    if (mode !== undefined && slots > 0) {
        const searchIn = (await store.hopCorpus?.()) ?? corpus;
        hopCorpus = searchIn;
        const reserved = new Set(firstPass.slice(0, options.topK - slots));
        const otherDocumentsOnly = (options.hopScope ?? DEFAULT_HOP_SCOPE) === 'other-documents';
        const eligible = (id: string) => !reserved.has(id) && !secondPass.includes(id) && !(otherDocumentsOnly && corpus.indexById.has(id));
        const searchSecond = async (query: string, embedding: number[]) => {
            const d = store.hopDenseSearch ? await store.hopDenseSearch(embedding, candidates) : await store.denseSearch(embedding, candidates);
            return fusedSearch(searchIn, d, query, true, weights, candidates);
        };

        if (useGraph) {
            const { entities, relations } = await store.graph();
            const seeds = linkQueryEntities(queryText, entities);
            linkedEntities = seeds.map((s) => s.entity.name);
            const context = firstPass.slice(0, HOP_CONTEXT).map((id) => corpus.normTexts[corpus.indexById.get(id)!]);
            const bridges = selectHopEntities(queryText, seeds, context, entities, relations, slots);
            // Entities the question names are looked up too: what the user read about them may be in an earlier book.
            const targets = [...bridges, ...seeds].sort((a, b) => b.score - a.score);

            if (mode === 'rerank') {
                // KG as a re-ranker of the plain second pass: no extra searches. The bridges are
                // recorded all the same, so the caller can see what the graph pointed to.
                hopEntities.push(...bridges.map((b) => b.entity.name));
                const plain = (await searchSecond(queryText, queryEmbedding)).filter(eligible).slice(0, candidates);
                const names = targets.map((t) => ({ name: normalizeText(t.entity.name).trim(), score: t.score }));
                const graphOrder = plain
                    .map((id) => ({ id, score: names.reduce((s, t) => s + (containsPhrase(searchIn.normTexts[searchIn.indexById.get(id)!], t.name) ? t.score : 0), 0) }))
                    .filter((x) => x.score > 0)
                    .sort((a, b) => b.score - a.score)
                    .map((x) => x.id);
                for (const { id } of reciprocalRankFusion([{ ids: plain, weight: 1 }, { ids: graphOrder, weight: 1 }])) {
                    if (secondPass.length >= slots) break;
                    secondPass.push(id);
                }
            }

            for (const target of mode === 'rerank' ? [] : targets) {
                if (secondPass.length >= slots) break;
                const query = `${target.entity.name} ${queryText}`;
                const ranked = await searchSecond(query, await options.embed!(query));
                const name = normalizeText(target.entity.name).trim();
                const pick = ranked.find((id) => eligible(id) && containsPhrase(searchIn.normTexts[searchIn.indexById.get(id)!], name));
                if (pick) {
                    secondPass.push(pick);
                    hopEntities.push(target.entity.name);
                }
            }
            graphEntities = entities;
            graphRelations = relations;
            if (targets.length > 0 && (options.facts ?? DEFAULT_FACTS) === 'all') {
                graphFacts = relationFacts([...seeds, ...bridges], relations, new Map(entities.map((e) => [e.id, e])));
            }
        }

        if (usePlain && secondPass.length < slots) {
            for (const id of await searchSecond(queryText, queryEmbedding)) {
                if (secondPass.length >= slots) break;
                if (eligible(id)) secondPass.push(id);
            }
        }
    }

    // Pass 1 keeps the first slots; second-pass passages take the last ones.
    const ids = [...firstPass.filter((id) => !secondPass.includes(id)).slice(0, options.topK - secondPass.length), ...secondPass];
    const missing = ids.filter((id) => !similarity.has(id));
    if (missing.length > 0) {
        for (const [id, sim] of await store.similarities(missing, queryEmbedding)) similarity.set(id, sim);
    }

    const chunks = ids.flatMap((id) => {
        const inScope = corpus.indexById.get(id);
        if (inScope !== undefined) return [{ ...corpus.chunks[inScope], similarity: similarity.get(id) ?? 0 }];
        const outside = hopCorpus?.indexById.get(id);
        return outside === undefined ? [] : [{ ...hopCorpus!.chunks[outside], similarity: similarity.get(id) ?? 0 }];
    });

    if ((options.facts ?? DEFAULT_FACTS) === 'linked' && graphRelations.length > 0) {
        graphFacts = linkFacts(queryText, chunks, corpus, graphEntities, graphRelations);
    }

    return { chunks, topSimilarity: dense[0]?.similarity ?? 0, graphFacts, linkedEntities, hopEntities };
}

/**
 * Relations that explain a cross-book passage: one end named in a passage
 * from another book, the other in the question or in a passage of the book in
 * scope. Empty when every passage comes from the book in scope.
 */
export function linkFacts(
    queryText: string,
    chunks: Array<CorpusChunk & { similarity: number }>,
    corpus: ScopeCorpus,
    entities: GraphEntity[],
    relations: GraphRelation[]
): string[] {
    const outside = chunks.filter((c) => !corpus.indexById.has(c.id)).map((c) => normalizeText(c.text));
    if (outside.length === 0) return [];
    const inside = [normalizeText(queryText), ...chunks.filter((c) => corpus.indexById.has(c.id)).map((c) => normalizeText(c.text))];
    const named = (texts: string[]) =>
        new Set(
            entities
                .filter((e) => {
                    const name = normalizeText(e.name).trim();
                    return name.length >= 3 && texts.some((t) => containsPhrase(t, name));
                })
                .map((e) => e.id)
        );
    const there = named(outside);
    const here = named(inside);
    const linking = relations.filter((r) => (there.has(r.sourceId) && here.has(r.targetId)) || (here.has(r.sourceId) && there.has(r.targetId)));
    return formatFacts(linking, new Map(entities.map((e) => [e.id, e])));
}
