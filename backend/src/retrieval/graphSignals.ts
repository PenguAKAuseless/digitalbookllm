import { containsPhrase, normalizeText, tokenize } from './text';

/**
 * Knowledge-graph helpers for the graph-guided second retrieval pass
 * (hybridRetriever.ts), in the spirit of GraphRAG local search (Edge et al.,
 * 2024) and iterative multi-hop retrieval, without an extra LLM call:
 *
 *   link   — which graph entities the question names;
 *   hop    — which *other* entities the graph connects them to (the bridge a
 *            multi-hop question needs, which the question itself never names);
 *   facts  — the relations involved, given to the LLM as structured context.
 */

export interface GraphEntity {
    id: string;
    name: string;
    type?: string | null;
}

export interface GraphRelation {
    sourceId: string;
    targetId: string;
    type: string;
}

export interface LinkedEntity {
    entity: GraphEntity;
    score: number;
}

const MIN_NAME_CHARS = 3;
const MAX_SEEDS = 5;
/** Seed weight of an entity named in a top first-pass passage rather than in the question. */
const PASSAGE_SEED_SCORE = 0.5;
/** A bridge candidate the top first-pass passages also name is the link the text itself makes. */
const MENTIONED_BONUS = 1.5;
const MAX_FACTS = 8;

const usableName = (name: string) => name.length >= MIN_NAME_CHARS && !/^\d+$/.test(name);

/** Entities whose name the question contains (score 1), or most of whose words it contains (score < 1). */
export function linkQueryEntities(query: string, entities: GraphEntity[]): LinkedEntity[] {
    const normQuery = normalizeText(query);
    const queryTokens = new Set(tokenize(query));
    const linked: LinkedEntity[] = [];

    for (const entity of entities) {
        const name = normalizeText(entity.name).trim();
        if (!usableName(name)) continue;

        if (containsPhrase(normQuery, name)) {
            linked.push({ entity, score: 1 });
            continue;
        }
        const nameTokens = [...new Set(tokenize(name))].filter((t) => t.length >= 2);
        if (nameTokens.length < 2) continue;
        const coverage = nameTokens.filter((t) => queryTokens.has(t)).length / nameTokens.length;
        if (coverage >= 0.6) linked.push({ entity, score: 0.8 * coverage });
    }

    // Prefer exact and longer (more specific) names; drop names contained in a longer linked name.
    linked.sort((a, b) => b.score - a.score || b.entity.name.length - a.entity.name.length);
    const kept: LinkedEntity[] = [];
    for (const candidate of linked) {
        const name = normalizeText(candidate.entity.name);
        if (kept.some((k) => k.score >= candidate.score && containsPhrase(normalizeText(k.entity.name), name))) continue;
        kept.push(candidate);
        if (kept.length === MAX_SEEDS) break;
    }
    return kept;
}

/**
 * Bridge entities for the second pass: entities one edge away from a seed —
 * an entity the question names (weight = its link score) or one a top
 * first-pass passage names (weight PASSAGE_SEED_SCORE) — that the question
 * does not mention. Candidates are scored by the summed weight of the seeds
 * they connect to, boosted when a top passage names them too.
 * `context` holds the top first-pass passages, normalizeText()ed.
 */
export function selectHopEntities(
    query: string,
    questionSeeds: LinkedEntity[],
    context: string[],
    entities: GraphEntity[],
    relations: GraphRelation[],
    max: number
): LinkedEntity[] {
    if (max <= 0 || relations.length === 0) return [];
    const normQuery = normalizeText(query);
    const byId = new Map(entities.map((e) => [e.id, e]));
    const mentionedInContext = (e: GraphEntity) => {
        const name = normalizeText(e.name).trim();
        return usableName(name) && context.some((text) => containsPhrase(text, name));
    };

    const seedScore = new Map<string, number>();
    for (const s of questionSeeds) seedScore.set(s.entity.id, s.score);
    for (const e of entities) {
        if (!seedScore.has(e.id) && mentionedInContext(e)) seedScore.set(e.id, PASSAGE_SEED_SCORE);
    }
    if (seedScore.size === 0) return [];

    const scores = new Map<string, number>();
    for (const r of relations) {
        for (const [from, to] of [[r.sourceId, r.targetId], [r.targetId, r.sourceId]] as const) {
            const weight = seedScore.get(from);
            if (weight === undefined || from === to) continue;
            const target = byId.get(to);
            if (!target) continue;
            const name = normalizeText(target.name).trim();
            if (!usableName(name) || containsPhrase(normQuery, name) || questionSeeds.some((s) => s.entity.id === to)) continue;
            scores.set(to, (scores.get(to) ?? 0) + weight);
        }
    }

    return [...scores.entries()]
        .map(([id, score]) => {
            const entity = byId.get(id)!;
            return { entity, score: mentionedInContext(entity) ? score * MENTIONED_BONUS : score };
        })
        .sort((a, b) => b.score - a.score || b.entity.name.length - a.entity.name.length)
        .slice(0, max);
}

/** One-line facts for the prompt ("A — relation → B"), deduplicated, at most MAX_FACTS. */
export function formatFacts(relations: GraphRelation[], entitiesById: Map<string, GraphEntity>): string[] {
    const facts: string[] = [];
    for (const r of relations) {
        const source = entitiesById.get(r.sourceId)?.name;
        const target = entitiesById.get(r.targetId)?.name;
        if (!source || !target) continue;
        const fact = `${source} — ${r.type} → ${target}`;
        if (facts.includes(fact)) continue;
        facts.push(fact);
        if (facts.length === MAX_FACTS) break;
    }
    return facts;
}

/** Relations among the given entities (seeds and bridges), as one-line facts for the prompt. Edges between two of them come first. */
export function relationFacts(involved: LinkedEntity[], relations: GraphRelation[], entitiesById: Map<string, GraphEntity>): string[] {
    const ids = new Set(involved.map((s) => s.entity.id));
    const touching = relations.filter((r) => ids.has(r.sourceId) || ids.has(r.targetId));
    touching.sort((a, b) => Number(ids.has(b.sourceId) && ids.has(b.targetId)) - Number(ids.has(a.sourceId) && ids.has(a.targetId)));

    const facts: string[] = [];
    const seen = new Set<string>();
    for (const r of touching) {
        const source = entitiesById.get(r.sourceId)?.name;
        const target = entitiesById.get(r.targetId)?.name;
        if (!source || !target) continue;
        const fact = `${source} — ${r.type} → ${target}`;
        if (seen.has(fact)) continue;
        seen.add(fact);
        facts.push(fact);
        if (facts.length === MAX_FACTS) break;
    }
    return facts;
}
