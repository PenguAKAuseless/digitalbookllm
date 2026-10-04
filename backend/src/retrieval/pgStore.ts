import { pool } from '../db/config';
import { GraphEntity, GraphRelation } from './graphSignals';
import { CorpusChunk, RetrievalStore, ScopeCorpus } from './hybridRetriever';

/** A document scope keeps its workspace: the knowledge graph reaches across the workspace's other books. */
export type RetrievalScope = { kind: 'document'; documentId: string; workspaceId: string } | { kind: 'workspace'; workspaceId: string };

const MAX_CACHED_CORPORA = 20;
const GRAPH_CACHE_TTL_MS = 30_000;

/** Corpora keyed by scope, invalidated by a fingerprint of the scope's chunks (re-ingestion replaces them). */
const corpusCache = new Map<string, { fingerprint: string; corpus: ScopeCorpus }>();
const graphCache = new Map<string, { expiresAt: number; entities: GraphEntity[]; relations: Array<GraphRelation & { documentId: string | null }> }>();

/**
 * pgvector-backed retrieval store for one user and scope. Every query is
 * scoped by `user_id` as well as the document/workspace (NFR04.1).
 */
export class PgRetrievalStore implements RetrievalStore {
    constructor(private userId: string, private scope: RetrievalScope) {}

    /** SQL restricting `c.document_id` to the scope, reading the scope id from placeholder `$n`. */
    private scopeFilter(n: number): { sql: string; param: string } {
        return this.scope.kind === 'document'
            ? { sql: `c.document_id = $${n}`, param: this.scope.documentId }
            : { sql: `c.document_id IN (SELECT id FROM documents WHERE workspace_id = $${n})`, param: this.scope.workspaceId };
    }

    async denseSearch(queryEmbedding: number[], limit: number) {
        const filter = this.scopeFilter(2);
        const { rows } = await pool.query(
            `SELECT c.id, 1 - (c.embedding <=> $1::vector) AS similarity
             FROM chunks c
             WHERE ${filter.sql} AND c.user_id = $3
             ORDER BY c.embedding <=> $1::vector
             LIMIT $4`,
            [JSON.stringify(queryEmbedding), filter.param, this.userId, limit]
        );
        return rows.map((r) => ({ id: r.id as string, similarity: Number(r.similarity) }));
    }

    /** Dense search over the whole workspace, for the graph-guided second pass. */
    async hopDenseSearch(queryEmbedding: number[], limit: number) {
        const workspaceId = this.scope.workspaceId;
        const { rows } = await pool.query(
            `SELECT c.id, 1 - (c.embedding <=> $1::vector) AS similarity
             FROM chunks c
             WHERE c.document_id IN (SELECT id FROM documents WHERE workspace_id = $2) AND c.user_id = $3
             ORDER BY c.embedding <=> $1::vector
             LIMIT $4`,
            [JSON.stringify(queryEmbedding), workspaceId, this.userId, limit]
        );
        return rows.map((r) => ({ id: r.id as string, similarity: Number(r.similarity) }));
    }

    async similarities(ids: string[], queryEmbedding: number[]) {
        const { rows } = await pool.query(
            `SELECT id, 1 - (embedding <=> $1::vector) AS similarity FROM chunks WHERE id = ANY($2) AND user_id = $3`,
            [JSON.stringify(queryEmbedding), ids, this.userId]
        );
        return new Map(rows.map((r) => [r.id as string, Number(r.similarity)]));
    }

    async corpus(): Promise<ScopeCorpus> {
        return this.loadCorpus(this.scopeFilter(1), `${this.scope.kind}:${this.scope.kind === 'document' ? this.scope.documentId : this.scope.workspaceId}`);
    }

    async hopCorpus(): Promise<ScopeCorpus> {
        if (this.scope.kind === 'workspace') return this.corpus();
        return this.loadCorpus(
            { sql: `c.document_id IN (SELECT id FROM documents WHERE workspace_id = $1)`, param: this.scope.workspaceId },
            `workspace:${this.scope.workspaceId}`
        );
    }

    private async loadCorpus(filter: { sql: string; param: string }, scopeKey: string): Promise<ScopeCorpus> {
        const key = `${this.userId}:${scopeKey}`;
        const { rows: stats } = await pool.query(
            `SELECT COUNT(*)::int AS n, MAX(c.created_at) AS latest FROM chunks c WHERE ${filter.sql} AND c.user_id = $2`,
            [filter.param, this.userId]
        );
        const fingerprint = `${stats[0].n}:${stats[0].latest?.toISOString?.() ?? ''}`;
        const cached = corpusCache.get(key);
        if (cached && cached.fingerprint === fingerprint) {
            corpusCache.delete(key);
            corpusCache.set(key, cached); // keep most recently used last
            return cached.corpus;
        }

        const { rows } = await pool.query(
            `SELECT c.id, c.text, c.page_number, c.document_id, d.title AS document_name
             FROM chunks c JOIN documents d ON d.id = c.document_id
             WHERE ${filter.sql} AND c.user_id = $2
             ORDER BY c.document_id, c.chunk_index`,
            [filter.param, this.userId]
        );
        const corpus = new ScopeCorpus(rows as CorpusChunk[]);
        corpusCache.set(key, { fingerprint, corpus });
        if (corpusCache.size > MAX_CACHED_CORPORA) corpusCache.delete(corpusCache.keys().next().value!);
        return corpus;
    }

    async graph() {
        let cached = graphCache.get(this.userId);
        if (!cached || cached.expiresAt < Date.now()) {
            const [entities, relations] = await Promise.all([
                pool.query(`SELECT id, name, type FROM entities WHERE user_id = $1`, [this.userId]),
                pool.query(
                    `SELECT source_entity_id AS "sourceId", target_entity_id AS "targetId", relation_type AS type,
                            source_document_id AS "documentId"
                     FROM entity_relations WHERE user_id = $1`,
                    [this.userId]
                ),
            ]);
            cached = { expiresAt: Date.now() + GRAPH_CACHE_TTL_MS, entities: entities.rows, relations: relations.rows };
            graphCache.set(this.userId, cached);
        }

        // Relations learned from any document in the workspace, or from chat; other workspaces stay out.
        const inScope = await this.workspaceDocumentIds();
        return {
            entities: cached.entities,
            relations: cached.relations.filter((r) => r.documentId === null || inScope.has(r.documentId)),
        };
    }

    private async workspaceDocumentIds(): Promise<Set<string>> {
        const { rows } = await pool.query(`SELECT id FROM documents WHERE workspace_id = $1 AND user_id = $2`, [
            this.scope.workspaceId,
            this.userId,
        ]);
        return new Set(rows.map((r) => r.id as string));
    }
}
