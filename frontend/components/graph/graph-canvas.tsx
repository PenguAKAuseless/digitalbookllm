"use client"

import { memo, useEffect, useMemo } from "react"
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    MiniMap,
    Handle,
    Position,
    Node,
    NodeProps,
    Edge,
    MarkerType,
    useReactFlow,
    useStore,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GraphNode, GraphEdge } from "@/lib/api/graph"
import { forceLayout } from "@/lib/graph-layout"
import { cachedLayout } from "@/lib/graph-cache"

const TYPE_COLORS: Record<string, string> = {
    person: "#f87171",
    character: "#f87171",
    "nhân vật": "#f87171",
    "người": "#f87171",
    concept: "#60a5fa",
    "khái niệm": "#60a5fa",
    technology: "#34d399",
    "công nghệ": "#34d399",
    place: "#fbbf24",
    location: "#fbbf24",
    "địa điểm": "#fbbf24",
    organization: "#f472b6",
    organisation: "#f472b6",
    "tổ chức": "#f472b6",
    event: "#22d3ee",
    "sự kiện": "#22d3ee",
    default: "#a78bfa",
}

/** Below this zoom only core concepts (and the selection) keep their labels; the rest become dots sized by degree. */
const LABEL_ZOOM = 0.55
/** Share of nodes, by number of relations, drawn as core concepts. */
const CORE_SHARE = 0.1
const CORE_MIN_DEGREE = 3

type EntityData = {
    label: string
    color: string
    degree: number
    core: boolean
    /** 'selected' | 'neighbour' | 'dimmed' | undefined (nothing selected) */
    focus?: "selected" | "neighbour" | "dimmed"
}
type EntityNodeType = Node<EntityData, "entity">

const colorOf = (type: string) => TYPE_COLORS[type.toLowerCase()] ?? TYPE_COLORS.default

/**
 * One entity. Semantic zoom: when the view is zoomed out, ordinary nodes
 * shrink to dots and only the core concepts keep a label, so the overview
 * shows the graph's structure instead of overlapping text.
 */
const EntityNode = memo(function EntityNode({ data }: NodeProps<EntityNodeType>) {
    const zoom = useStore((s) => s.transform[2])
    const showLabel = data.core || data.focus === "selected" || data.focus === "neighbour" || zoom >= LABEL_ZOOM
    const opacity = data.focus === "dimmed" ? 0.25 : data.degree === 0 ? 0.6 : 1
    const ring = data.focus === "selected" ? "0 0 0 3px var(--color-ring, #6366f1)" : undefined
    const handle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, top: "50%", left: "50%" }

    return (
        <div title={data.label} style={{ opacity, transition: "opacity 150ms" }}>
            <Handle type="target" position={Position.Top} style={handle} isConnectable={false} />
            {showLabel ? (
                <div
                    style={{
                        background: data.color,
                        color: "white",
                        borderRadius: 999,
                        boxShadow: ring,
                        whiteSpace: "nowrap",
                        maxWidth: data.core ? 280 : 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: data.core ? Math.min(22, 14 + Math.sqrt(data.degree) * 1.5) : 12,
                        fontWeight: data.core ? 700 : 400,
                        padding: data.core ? "8px 16px" : "4px 10px",
                    }}
                >
                    {data.label}
                </div>
            ) : (
                <div
                    style={{
                        background: data.color,
                        borderRadius: 999,
                        boxShadow: ring,
                        width: 10 + Math.min(16, data.degree * 3),
                        height: 10 + Math.min(16, data.degree * 3),
                    }}
                />
            )}
            <Handle type="source" position={Position.Bottom} style={handle} isConnectable={false} />
        </div>
    )
})

const nodeTypes = { entity: EntityNode }

interface GraphCanvasProps {
    nodes: GraphNode[]
    edges: GraphEdge[]
    /** Fingerprint of nodes+edges (graphSignature): the layout cache key. */
    signature: string
    selectedId: string | null
    onNodeClick: (id: string) => void
}

/** Node/Edge visualization for the personal knowledge graph (UC15). */
export function GraphCanvas(props: GraphCanvasProps) {
    return (
        <ReactFlowProvider>
            <GraphCanvasInner {...props} />
        </ReactFlowProvider>
    )
}

function GraphCanvasInner({ nodes, edges, signature, selectedId, onNodeClick }: GraphCanvasProps) {
    const { fitView, setCenter, getNode } = useReactFlow()

    const { positions, degree, core, mainComponent, visibleEdges } = useMemo(() => {
        const nodeIds = new Set(nodes.map((n) => n.id))
        const visibleEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        const positions = cachedLayout(signature, () => forceLayout(nodes.map((n) => n.id), visibleEdges))

        const degree = new Map<string, number>()
        for (const e of visibleEdges) {
            degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
            degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
        }
        const degrees = [...degree.values()].sort((a, b) => b - a)
        const threshold = Math.max(CORE_MIN_DEGREE, degrees[Math.floor(nodes.length * CORE_SHARE)] ?? Infinity)
        const core = new Set(nodes.filter((n) => (degree.get(n.id) ?? 0) >= threshold).map((n) => n.id))

        // The initial view frames the largest cluster, readable at a sensible zoom.
        const adjacency = new Map<string, string[]>()
        for (const e of visibleEdges) {
            adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
            adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source])
        }
        let mainComponent: string[] = []
        const seen = new Set<string>()
        for (const n of nodes) {
            if (seen.has(n.id)) continue
            const component: string[] = []
            const stack = [n.id]
            seen.add(n.id)
            while (stack.length) {
                const id = stack.pop()!
                component.push(id)
                for (const next of adjacency.get(id) ?? []) {
                    if (!seen.has(next)) {
                        seen.add(next)
                        stack.push(next)
                    }
                }
            }
            if (component.length > mainComponent.length) mainComponent = component
        }

        return { positions, degree, core, mainComponent, visibleEdges }
    }, [nodes, edges, signature])

    const neighbours = useMemo(() => {
        if (!selectedId) return null
        const set = new Set<string>()
        for (const e of visibleEdges) {
            if (e.source === selectedId) set.add(e.target)
            if (e.target === selectedId) set.add(e.source)
        }
        return set
    }, [selectedId, visibleEdges])

    const flowNodes: EntityNodeType[] = useMemo(
        () =>
            nodes.map((n) => ({
                id: n.id,
                type: "entity",
                position: positions.get(n.id) ?? { x: 0, y: 0 },
                zIndex: core.has(n.id) ? 2 : 1,
                data: {
                    label: n.name,
                    color: colorOf(n.type),
                    degree: degree.get(n.id) ?? 0,
                    core: core.has(n.id),
                    focus: !selectedId ? undefined : n.id === selectedId ? "selected" : neighbours?.has(n.id) ? "neighbour" : "dimmed",
                },
            })),
        [nodes, positions, degree, core, selectedId, neighbours]
    )

    const flowEdges: Edge[] = useMemo(
        () =>
            visibleEdges.map((e) => {
                const touching = selectedId !== null && (e.source === selectedId || e.target === selectedId)
                return {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    type: "straight",
                    // Relation names are shown for the selected node's edges; the detail panel lists them all.
                    label: touching ? e.relation_type : undefined,
                    labelStyle: { fontSize: 11 },
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: {
                        stroke: touching ? "var(--color-primary, #6366f1)" : "var(--color-border, #999)",
                        strokeWidth: touching ? 2 : 1,
                        opacity: selectedId && !touching ? 0.2 : 1,
                    },
                }
            }),
        [visibleEdges, selectedId]
    )

    // Frame the main cluster whenever a different graph is shown.
    useEffect(() => {
        const frame = requestAnimationFrame(() =>
            fitView({ nodes: mainComponent.map((id) => ({ id })), padding: 0.2, maxZoom: 1.1, duration: 300 })
        )
        return () => cancelAnimationFrame(frame)
    }, [signature, mainComponent, fitView])

    // Glide to the selected node.
    useEffect(() => {
        if (!selectedId) return
        const node = getNode(selectedId)
        if (!node) return
        const w = node.measured?.width ?? 0
        const h = node.measured?.height ?? 0
        setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1.1, duration: 400 })
    }, [selectedId, getNode, setCenter])

    return (
        <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => onNodeClick(node.id)}
            nodesConnectable={false}
            minZoom={0.05}
            maxZoom={2.5}
            zoomOnDoubleClick={false}
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
        >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap
                pannable
                zoomable
                nodeColor={(n) => (n.data as EntityData).color}
                nodeStrokeWidth={0}
                className="hidden! sm:block!"
            />
        </ReactFlow>
    )
}
