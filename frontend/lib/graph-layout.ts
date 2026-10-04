/**
 * Graph layout for the knowledge-graph view. A personal knowledge graph is
 * many separate clusters (one per topic or book section), so:
 *
 *   1. split the graph into connected components;
 *   2. lay out each component with a force-directed simulation
 *      (Fruchterman & Reingold, 1991): every pair repels, every edge pulls
 *      its ends together, so related entities form readable clusters;
 *   3. pack the components side by side, largest first, in rows.
 *
 * Laying components out together instead would push them far apart and
 * shrink every cluster to a dot once the view is fitted to the screen.
 * Deterministic: the same graph always gets the same picture.
 */
export interface LayoutEdge {
    source: string
    target: string
}

type Point = { x: number; y: number }

const SPACING = 140 // ideal edge length, px
const GAP = 120 // space between packed components, px

export function forceLayout(nodeIds: string[], edges: LayoutEdge[]): Map<string, Point> {
    const positions = new Map<string, Point>()
    if (nodeIds.length === 0) return positions

    const components = connectedComponents(nodeIds, edges)
    const laidOut = components.map((ids) => {
        const set = new Set(ids)
        const local = simulate(ids, edges.filter((e) => set.has(e.source) && set.has(e.target)))
        const xs = [...local.values()].map((p) => p.x)
        const ys = [...local.values()].map((p) => p.y)
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        return { local, minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
    })

    // Shelf packing: rows about as wide as the square root of the total area.
    const totalArea = laidOut.reduce((s, c) => s + (c.width + GAP) * (c.height + GAP), 0)
    const rowWidth = Math.max(Math.sqrt(totalArea) * 1.3, ...laidOut.map((c) => c.width + GAP))
    let x = 0
    let y = 0
    let rowHeight = 0
    for (const c of laidOut) {
        if (x > 0 && x + c.width > rowWidth) {
            x = 0
            y += rowHeight + GAP
            rowHeight = 0
        }
        for (const [id, p] of c.local) positions.set(id, { x: x + p.x - c.minX, y: y + p.y - c.minY })
        x += c.width + GAP
        rowHeight = Math.max(rowHeight, c.height)
    }
    return positions
}

/** Components, largest first (ties keep input order). */
function connectedComponents(nodeIds: string[], edges: LayoutEdge[]): string[][] {
    const parent = new Map(nodeIds.map((id) => [id, id]))
    const find = (id: string): string => {
        let root = id
        while (parent.get(root) !== root) root = parent.get(root)!
        parent.set(id, root)
        return root
    }
    for (const e of edges) {
        if (!parent.has(e.source) || !parent.has(e.target)) continue
        parent.set(find(e.source), find(e.target))
    }
    const groups = new Map<string, string[]>()
    for (const id of nodeIds) {
        const root = find(id)
        if (!groups.has(root)) groups.set(root, [])
        groups.get(root)!.push(id)
    }
    return [...groups.values()].sort((a, b) => b.length - a.length)
}

function simulate(nodeIds: string[], edges: LayoutEdge[]): Map<string, Point> {
    const n = nodeIds.length
    const result = new Map<string, Point>()
    if (n === 1) {
        result.set(nodeIds[0], { x: 0, y: 0 })
        return result
    }

    const index = new Map(nodeIds.map((id, i) => [id, i]))
    const links = edges.map((e) => [index.get(e.source)!, index.get(e.target)!] as const).filter(([a, b]) => a !== b)
    const iterations = n > 150 ? 200 : 300

    // Deterministic start on a sunflower spiral.
    const xs = new Float64Array(n)
    const ys = new Float64Array(n)
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
        const r = SPACING * 0.5 * Math.sqrt(i + 0.5)
        xs[i] = r * Math.cos(i * golden)
        ys[i] = r * Math.sin(i * golden)
    }

    const k = SPACING
    const k2 = k * k
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    let temperature = SPACING * Math.sqrt(n) * 0.3
    const cooling = temperature / (iterations + 1)

    for (let iter = 0; iter < iterations; iter++) {
        dx.fill(0)
        dy.fill(0)

        // Repulsion between every pair: k^2 / d.
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const ddx = xs[i] - xs[j]
                const ddy = ys[i] - ys[j]
                const d2 = Math.max(ddx * ddx + ddy * ddy, 1)
                const f = k2 / d2
                dx[i] += ddx * f
                dy[i] += ddy * f
                dx[j] -= ddx * f
                dy[j] -= ddy * f
            }
        }

        // Attraction along edges: d^2 / k.
        for (const [a, b] of links) {
            const ddx = xs[a] - xs[b]
            const ddy = ys[a] - ys[b]
            const f = Math.sqrt(ddx * ddx + ddy * ddy) / k
            dx[a] -= ddx * f
            dy[a] -= ddy * f
            dx[b] += ddx * f
            dy[b] += ddy * f
        }

        // Move each node at most `temperature` this step, then cool down.
        for (let i = 0; i < n; i++) {
            const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1
            const step = Math.min(len, temperature)
            xs[i] += (dx[i] / len) * step
            ys[i] += (dy[i] / len) * step
        }
        temperature = Math.max(temperature - cooling, SPACING * 0.02)
    }

    nodeIds.forEach((id, i) => result.set(id, { x: xs[i], y: ys[i] }))
    return result
}
