/**
 * Client-side caching for the knowledge-graph view:
 *
 *   - the last graph per scope (sessionStorage), shown instantly on the next
 *     visit while a fresh copy loads (stale-while-revalidate);
 *   - the computed layout per graph signature (memory + sessionStorage), so
 *     an unchanged graph is never laid out twice;
 *   - entity details per node, dropped whenever the graph changes.
 *
 * Storage can be unavailable (private mode, quota), so every access is
 * guarded and the page works without it.
 */
import type { EntityDetail, GraphEdge, GraphNode } from "@/lib/api/graph"

type Point = { x: number; y: number }
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }

const DATA_PREFIX = "kg:data:"
const LAYOUT_PREFIX = "kg:layout:"

function readJson<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(key)
        return raw ? (JSON.parse(raw) as T) : null
    } catch {
        return null
    }
}

function writeJson(key: string, value: unknown) {
    try {
        sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Storage full or blocked: the cache is an optimisation only.
    }
}

/** Order-independent fingerprint of the graph's nodes and edges (FNV-1a over sorted ids). */
export function graphSignature(nodes: GraphNode[], edges: GraphEdge[]): string {
    const parts = [
        ...nodes.map((n) => `n${n.id}:${n.type}:${n.name}`).sort(),
        ...edges.map((e) => `e${e.source}>${e.target}:${e.relation_type}`).sort(),
    ]
    let hash = 0x811c9dc5
    for (const part of parts) {
        for (let i = 0; i < part.length; i++) {
            hash ^= part.charCodeAt(i)
            hash = Math.imul(hash, 0x01000193) >>> 0
        }
    }
    return `${nodes.length}-${edges.length}-${hash.toString(36)}`
}

export function readCachedGraph(scopeKey: string): GraphData | null {
    return readJson<GraphData>(DATA_PREFIX + scopeKey)
}

export function writeCachedGraph(scopeKey: string, data: GraphData) {
    writeJson(DATA_PREFIX + scopeKey, data)
}

const layoutMemory = new Map<string, Map<string, Point>>()

/** Returns the cached layout for this graph, computing and storing it on a miss. */
export function cachedLayout(signature: string, compute: () => Map<string, Point>): Map<string, Point> {
    const inMemory = layoutMemory.get(signature)
    if (inMemory) return inMemory

    const stored = readJson<Array<[string, Point]>>(LAYOUT_PREFIX + signature)
    if (stored) {
        const layout = new Map(stored)
        layoutMemory.set(signature, layout)
        return layout
    }

    const layout = compute()
    layoutMemory.set(signature, layout)
    writeJson(LAYOUT_PREFIX + signature, [...layout.entries()].map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]))
    return layout
}

const detailMemory = new Map<string, EntityDetail>()
let detailSignature = ""

/** Entity details are cached per graph version: any change to the graph clears them. */
export async function cachedEntityDetail(signature: string, id: string, load: () => Promise<EntityDetail>): Promise<EntityDetail> {
    if (signature !== detailSignature) {
        detailMemory.clear()
        detailSignature = signature
    }
    const hit = detailMemory.get(id)
    if (hit) return hit
    const detail = await load()
    detailMemory.set(id, detail)
    return detail
}
