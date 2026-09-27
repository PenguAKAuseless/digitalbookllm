"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { Header } from "@/components/layout/header"
import { GraphCanvas } from "@/components/graph/graph-canvas"
import { EntityDetailPanel } from "@/components/graph/entity-detail-panel"
import { graphAPI, GraphNode, GraphEdge, EntityDetail } from "@/lib/api/graph"
import { Loader2, Network } from "lucide-react"

export default function GraphPage() {
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const router = useRouter()
    const { user, loading } = useAuth()
    const { t } = useI18n()

    const [nodes, setNodes] = useState<GraphNode[]>([])
    const [edges, setEdges] = useState<GraphEdge[]>([])
    const [detail, setDetail] = useState<EntityDetail | null>(null)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        graphAPI.getGraph().then(({ nodes, edges }) => {
            setNodes(nodes)
            setEdges(edges)
            setReady(true)
        })
    }, [])

    const handleNodeClick = async (id: string) => {
        const entityDetail = await graphAPI.getEntity(id)
        setDetail(entityDetail)
    }

    if (loading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="flex h-screen flex-col bg-background">
            <Header
                breadcrumb={t("graph.title")}
                viewMode="graph"
                onViewModeChange={(mode) => {
                    if (mode !== "graph") router.push(`/library`)
                }}
            />

            <div className="relative flex-1">
                {!ready ? (
                    <div className="h-full flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                ) : nodes.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Network className="w-10 h-10" />
                        <p className="text-sm">{t("graph.empty")}</p>
                    </div>
                ) : (
                    <GraphCanvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} />
                )}

                {detail && <EntityDetailPanel detail={detail} onClose={() => setDetail(null)} />}
            </div>
        </div>
    )
}
