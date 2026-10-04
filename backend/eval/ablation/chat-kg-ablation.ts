/**
 * KG-Chat experiment (eval/datasets/kg-chat): does the knowledge graph learn
 * new entities from conversations, and attach them to what it already holds?
 *
 * Protocol. The user's graph starts as the one built from the three KG-Series
 * volumes (a user who has read those books). The 40 OpenDialKG dialogues are
 * then processed one after another, each as one chat-extraction job: the
 * dialogue's turns joined the way enqueueChatExtraction joins chat exchanges,
 * sent through the production extractor (extractionWindows + extractWindowGraph,
 * with the existing entities the text names offered as known names), and
 * merged into the graph as the worker does — names matched case-insensitively
 * to existing entities, duplicate edges skipped.
 *
 * Measured per dialogue, against OpenDialKG's annotated triples:
 *   - new entities: nodes added that the graph did not hold before the dialogue;
 *   - grounded: extracted entities whose name occurs in the dialogue (not invented);
 *   - entity recall: annotated entities found among the extracted ones;
 *   - relation recall: annotated triples with an extracted edge between their entities (either direction);
 *   - attached: new entities with an edge to a node that existed before the dialogue;
 *   - reuse: annotated entities the graph already held, matched to the existing node instead of a new one.
 * Baselines on the same dialogues: a capitalised-phrase extractor with
 * same-turn co-occurrence edges (no LLM), and the previous exact-name merge.
 *
 * Usage: OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b-8k GROQ_API_KEY= \
 *        npx ts-node eval/ablation/chat-kg-ablation.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { extractionWindows, extractWindowGraph } from '../../src/queue/handlers/extractEntities';
import { containsPhrase, normalizeText } from '../../src/retrieval/text';
import type { ChatDialogue } from './build-chat-benchmark';
import { mentioned } from './build-chat-benchmark';
import { buildGraph, installGroqRateLimiter, lastGroqModel, pct, RESULTS_DIR, writeResult } from './shared';

const DATASET = path.join(__dirname, '..', 'datasets', 'kg-chat', 'dialogues.json');
const SERIES = path.join(__dirname, '..', 'datasets', 'kg-series');
const CACHE_FILE = path.join(RESULTS_DIR, 'kg-cache-chat.json');

interface Node {
    id: string;
    name: string;
    origin: 'book' | string; // 'book' or the dialogue id that created it
}

class Graph {
    nodes: Node[] = [];
    edges = new Set<string>();
    edgeList: Array<{ a: string; b: string }> = [];
    private byKey = new Map<string, Node>();

    constructor(private caseInsensitive: boolean) {}

    private key(name: string) {
        return this.caseInsensitive ? name.toLowerCase() : name;
    }

    find(name: string): Node | undefined {
        return this.byKey.get(this.key(name));
    }

    resolve(name: string, origin: string): { node: Node; created: boolean } {
        const clean = name.replace(/\s+/g, ' ').trim();
        const hit = this.byKey.get(this.key(clean));
        if (hit) return { node: hit, created: false };
        const node = { id: `n${this.nodes.length}`, name: clean, origin };
        this.nodes.push(node);
        this.byKey.set(this.key(clean), node);
        return { node, created: true };
    }

    addEdge(a: Node, b: Node, type: string) {
        const k = `${a.id}|${b.id}|${type}`;
        if (this.edges.has(k) || a === b) return false;
        this.edges.add(k);
        this.edgeList.push({ a: a.id, b: b.id });
        return true;
    }

    /** Groups of nodes whose names differ only in letter case or spacing: duplicates of one entity. */
    duplicateGroups(): number {
        const seen = new Map<string, number>();
        for (const n of this.nodes) {
            const k = n.name.toLowerCase().replace(/\s+/g, ' ');
            seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        return [...seen.values()].filter((c) => c > 1).length;
    }
}

const cache: Record<string, any> = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) : {};

async function extract(window: string, knownNames: string[]) {
    const key = createHash('sha1').update(window).digest('hex');
    if (!cache[key]) {
        const g = await extractWindowGraph(window, knownNames);
        cache[key] = { ...g, model: process.env.OLLAMA_BASE_URL ? `ollama/${process.env.OLLAMA_MODEL}` : lastGroqModel };
        fs.mkdirSync(RESULTS_DIR, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    }
    return cache[key] as { entities: Array<{ name: string }>; relations: Array<{ source: string; target: string; type: string }>; model: string };
}

/** Annotated entity matched by an extracted name: equal or containing each other as whole words, ignoring "(…)" qualifiers. */
function sameEntity(gold: string, name: string): boolean {
    const variants = (s: string) => [normalizeText(s).trim(), normalizeText(s.replace(/\s*\(.*\)\s*$/, '')).trim()].filter((v) => v.length >= 3);
    for (const g of variants(gold)) {
        for (const n of variants(name)) {
            if (g === n || containsPhrase(g, n) || containsPhrase(n, g)) return true;
        }
    }
    return false;
}

/** Same entity name: equal after lower-casing, whitespace folding and dropping a "(…)" qualifier. */
function sameName(a: string, b: string): boolean {
    const n = (s: string) => normalizeText(s.replace(/\s*\(.*\)\s*$/, '')).trim();
    return n(a) === n(b);
}

/** No-LLM baseline: capitalised phrases as entities, co-occurrence within a turn as edges. */
const STOP = new Set(['i', 'do', 'yes', 'no', 'sure', 'what', 'how', 'have', 'did', 'is', 'it', 'its', "it's", 'that', 'thanks', 'thank', 'oh', 'great', 'hi', 'hello', 'okay', 'ok', 'well', 'so', 'and', 'the', 'you', 'he', 'she', 'they', 'we', 'my', 'are', 'was', 'can', 'could', 'would', 'do you', 'any', 'awesome', 'cool', 'welcome', 'whoops', 'have a', 'not']);
function heuristicExtract(turns: string[]) {
    const phrase = /\b[A-Z][\w'.&-]*(?:\s+(?:of|the|and|de|in|on|&)?\s*[A-Z][\w'.&-]*)*/g;
    const entities = new Set<string>();
    const relations: Array<{ source: string; target: string }> = [];
    for (const turn of turns) {
        const found = [...new Set((turn.match(phrase) ?? []).map((p) => p.trim()).filter((p) => p.length >= 3 && !STOP.has(p.toLowerCase())))];
        found.forEach((e) => entities.add(e));
        for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) relations.push({ source: found[i], target: found[j] });
    }
    return { entities: [...entities], relations };
}

function scoreAgainstGold(d: ChatDialogue, names: string[], relations: Array<{ source: string; target: string }>) {
    const foundEntities = d.entities.filter((g) => names.some((n) => sameEntity(g, n)));
    const foundTriples = d.triples.filter((t) =>
        relations.some(
            (r) =>
                (sameEntity(t.subject, r.source) && sameEntity(t.object, r.target)) || (sameEntity(t.subject, r.target) && sameEntity(t.object, r.source))
        )
    );
    return { entityHits: foundEntities.length, tripleHits: foundTriples.length };
}

async function seriesGraph(graph: Graph) {
    for (const n of [1, 2, 3]) {
        const document = fs.readFileSync(path.join(SERIES, `volume-${n}.txt`), 'utf-8');
        const g = await buildGraph({ name: `series-vol${n}`, document } as any);
        const local = new Map(g.entities.map((e) => [e.id, e.name]));
        for (const e of g.entities) graph.resolve(e.name, 'book');
        for (const r of g.relations) graph.addEdge(graph.resolve(local.get(r.sourceId)!, 'book').node, graph.resolve(local.get(r.targetId)!, 'book').node, r.type);
    }
}

async function main() {
    installGroqRateLimiter();
    const dialogues: ChatDialogue[] = JSON.parse(fs.readFileSync(DATASET, 'utf-8'));

    const graph = new Graph(true); // production: case-insensitive merge
    const exact = new Graph(false); // previous behaviour: exact-name merge
    await seriesGraph(graph);
    await seriesGraph(exact);
    const bookNodes = graph.nodes.length;
    const bookEdges = graph.edgeList.length;

    const totals = { connected: 0, entities: 0, triples: 0, extracted: 0, grounded: 0, newNodes: 0, attached: 0, entityHits: 0, tripleHits: 0, preexistingGold: 0, reused: 0, heurEntityHits: 0, heurTripleHits: 0, heurExtracted: 0 };
    const perDialogue: unknown[] = [];
    const models = new Set<string>();

    for (const d of dialogues) {
        const text = d.turns.map((t) => t.text).join('\n\n');
        const normText = normalizeText(text);
        const before = new Set(graph.nodes.map((n) => n.id));
        // Annotated entities the graph already held before this dialogue (from the books or earlier
        // chats), by name: "Iron Man" held does not make "Iron Man 3" pre-existing.
        const preexisting = d.entities.filter((g) => graph.nodes.some((n) => sameName(g, n.name)));

        const names: string[] = [];
        const rels: Array<{ source: string; target: string; type: string }> = [];
        for (const window of extractionWindows(text)) {
            const known = graph.nodes.filter((n) => n.name.length >= 3 && containsPhrase(normalizeText(window), normalizeText(n.name).trim())).map((n) => n.name).slice(0, 40);
            const out = await extract(window, known);
            models.add(out.model);
            for (const e of out.entities) if (typeof e.name === 'string' && e.name.trim()) names.push(e.name.trim());
            for (const r of out.relations) {
                if (typeof r.source !== 'string' || typeof r.target !== 'string') continue;
                names.push(r.source.trim(), r.target.trim()); // an edge endpoint becomes a node, as in the worker
                rels.push({ source: r.source.trim(), target: r.target.trim(), type: typeof r.type === 'string' && r.type.trim() ? r.type.trim() : 'related_to' });
            }
        }
        const unique = [...new Set(names)];

        // Merge, as the worker does, into both graphs.
        const created: string[] = [];
        for (const g of [graph, exact]) {
            for (const n of unique) {
                const { node, created: isNew } = g.resolve(n, d.id);
                if (g === graph && isNew) created.push(node.id);
            }
            for (const r of rels) g.addEdge(g.resolve(r.source, d.id).node, g.resolve(r.target, d.id).node, r.type);
        }

        const createdSet = new Set(created);
        const attached = created.filter((id) =>
            graph.edgeList.some((e) => (e.a === id && before.has(e.b)) || (e.b === id && before.has(e.a)))
        ).length;
        const grounded = unique.filter((n) => mentioned(n, normText)).length;
        const { entityHits, tripleHits } = scoreAgainstGold(d, unique, rels);
        const connected = created.filter((id) => graph.edgeList.some((e) => e.a === id || e.b === id)).length;
        // A pre-existing annotated entity is reused when no node created in this dialogue matches it.
        const notReused = preexisting.flatMap((g) => {
            const twins = graph.nodes.filter((n) => createdSet.has(n.id) && sameName(g, n.name)).map((n) => n.name);
            return twins.length ? [{ gold: g, existing: graph.nodes.filter((n) => !createdSet.has(n.id) && sameName(g, n.name)).map((n) => n.name), created: twins }] : [];
        });
        const reused = preexisting.length - notReused.length;

        const heur = heuristicExtract(d.turns.map((t) => t.text));
        const heurScore = scoreAgainstGold(d, heur.entities, heur.relations);

        totals.entities += d.entities.length;
        totals.triples += d.triples.length;
        totals.extracted += unique.length;
        totals.grounded += grounded;
        totals.newNodes += created.length;
        totals.attached += attached;
        totals.connected += connected;
        totals.entityHits += entityHits;
        totals.tripleHits += tripleHits;
        totals.preexistingGold += preexisting.length;
        totals.reused += reused;
        totals.heurEntityHits += heurScore.entityHits;
        totals.heurTripleHits += heurScore.tripleHits;
        totals.heurExtracted += heur.entities.length;
        perDialogue.push({ id: d.id, extracted: unique, newNodes: created.length, attached, connected, notReused, grounded, entityHits, entities: d.entities.length, tripleHits, triples: d.triples.length, preexisting, reused });
        console.log(`${d.id}: +${created.length} nodes (${attached} attached), entities ${entityHits}/${d.entities.length}, triples ${tripleHits}/${d.triples.length}`);
    }

    const N = dialogues.length;
    console.log(`\n### KG-Chat: ${N} OpenDialKG dialogues, ${totals.entities} annotated entities, ${totals.triples} annotated triples`);
    console.log(`Graph before the chats (from the KG-Series books): ${bookNodes} entities, ${bookEdges} relations`);
    console.log(`Graph after the chats: ${graph.nodes.length} entities (+${graph.nodes.length - bookNodes}), ${graph.edgeList.length} relations (+${graph.edgeList.length - bookEdges})\n`);
    console.log('| Measure | LLM extractor (production) | Capitalised phrases + co-occurrence (no LLM) |');
    console.log('|---|---|---|');
    console.log(`| Annotated entities found (recall) | ${pct(totals.entityHits / totals.entities)} | ${pct(totals.heurEntityHits / totals.entities)} |`);
    console.log(`| Annotated relations found (recall) | ${pct(totals.tripleHits / totals.triples)} | ${pct(totals.heurTripleHits / totals.triples)} |`);
    console.log(`| Extracted entities per dialogue | ${(totals.extracted / N).toFixed(1)} | ${(totals.heurExtracted / N).toFixed(1)} |`);
    console.log(`| Extracted entities named in the dialogue (grounded) | ${pct(totals.grounded / totals.extracted)} | 100% by construction |`);
    console.log(`\n| Growth of the user graph | Value |`);
    console.log('|---|---|');
    console.log(`| New entities per dialogue | ${(totals.newNodes / N).toFixed(1)} |`);
    console.log(`| New entities with at least one relation (not isolated) | ${pct(totals.connected / totals.newNodes)} |`);
    console.log(`| New entities attached by an edge to an entity the graph already held | ${pct(totals.attached / totals.newNodes)} |`);
    console.log(`| Annotated entities already in the graph, reused instead of duplicated | ${totals.reused}/${totals.preexistingGold} |`);
    console.log(`| Duplicate entities (same name, other letter case), case-insensitive merge (production) | ${graph.duplicateGroups()} |`);
    console.log(`| Duplicate entities, exact-name merge (before) | ${exact.duplicateGroups()} |`);
    console.log(`\nModels: ${[...models].join(', ')}`);
    console.log(`Full results: ${writeResult('ablation-chat-kg.json', { totals, bookNodes, bookEdges, after: { nodes: graph.nodes.length, edges: graph.edgeList.length }, duplicates: { production: graph.duplicateGroups(), exactName: exact.duplicateGroups() }, perDialogue })}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
