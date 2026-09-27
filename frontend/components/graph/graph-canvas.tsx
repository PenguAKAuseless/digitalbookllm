"use client"

import { useMemo } from "react"
import { ReactFlow, Background, Controls, Node, Edge, MarkerType } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { GraphNode, GraphEdge } from "@/lib/api/graph"

const TYPE_COLORS: Record<string, string> = {
    person: "#f87171",
    character: "#f87171",
    concept: "#60a5fa",
    technology: "#34d399",
    default: "#a78bfa",
}

interface GraphCanvasProps {
    nodes: GraphNode[]
    edges: GraphEdge[]
    onNodeClick: (id: string) => void
}

/** Node/Edge visualization for the personal knowledge graph (UC15). */
export function GraphCanvas({ nodes, edges, onNodeClick }: GraphCanvasProps) {
    const { flowNodes, flowEdges } = useMemo(() => {
        // Simple radial layout — good enough at the scale a single reading
        // session's graph reaches; a force-directed layout is future work.
        const radius = 60 + nodes.length * 18
        const flowNodes: Node[] = nodes.map((n, i) => {
            const angle = (2 * Math.PI * i) / Math.max(1, nodes.length)
            const color = TYPE_COLORS[n.type.toLowerCase()] ?? TYPE_COLORS.default
            return {
                id: n.id,
                position: { x: radius * Math.cos(angle) + radius, y: radius * Math.sin(angle) + radius },
                data: { label: n.name },
                style: {
                    background: color,
                    color: "white",
                    borderRadius: 999,
                    border: "none",
                    fontSize: 12,
                    padding: "6px 12px",
                },
            }
        })

        const flowEdges: Edge[] = edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.relation_type,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "var(--color-border, #999)" },
        }))

        return { flowNodes, flowEdges }
    }, [nodes, edges])

    return (
        <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodeClick={(_, node) => onNodeClick(node.id)}
            fitView
            proOptions={{ hideAttribution: true }}
        >
            <Background />
            <Controls />
        </ReactFlow>
    )
}
