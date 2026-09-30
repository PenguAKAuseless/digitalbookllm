"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { Crumb, Header, ViewMode } from "@/components/layout/header"
import { GraphCanvas } from "@/components/graph/graph-canvas"
import { EntityDetailPanel } from "@/components/graph/entity-detail-panel"
import { graphAPI, GraphNode, GraphEdge, EntityDetail, ExtractionStatus } from "@/lib/api/graph"
import { documentAPI, DocumentDetail } from "@/lib/api/documents"
import { workspaceAPI } from "@/lib/api/workspaces"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle2, Loader2, Network, RefreshCw } from "lucide-react"

/** Extraction runs in the background after ingestion; while it is under way the graph is re-fetched as it grows. */
const POLL_MS = 4000

type Scope = "document" | "all"

export default function GraphPage() {
    return (
        <Suspense fallback={<FullScreenSpinner />}>
            <GraphPageContent />
        </Suspense>
    )
}

function GraphPageContent() {
    const { workspaceId } = useParams<{ workspaceId: string }>()
    const searchParams = useSearchParams()
    // The book the user came from, if any; the reader/split buttons route back to it.
    const documentId = searchParams.get("doc")
    const router = useRouter()
    const { user, loading } = useAuth()
    const { t } = useI18n()

    const [scope, setScope] = useState<Scope>(documentId ? "document" : "all")
    const [nodes, setNodes] = useState<GraphNode[]>([])
    const [edges, setEdges] = useState<GraphEdge[]>([])
    const [detail, setDetail] = useState<EntityDetail | null>(null)
    const [ready, setReady] = useState(false)
    const [doc, setDoc] = useState<DocumentDetail | null>(null)
    const [workspaceName, setWorkspaceName] = useState<string | null>(null)
    const [extraction, setExtraction] = useState<ExtractionStatus | null>(null)
    const [requesting, setRequesting] = useState(false)
    const [requestError, setRequestError] = useState<string | null>(null)

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        if (!user) return
        workspaceAPI.getWorkspace(workspaceId).then((ws) => setWorkspaceName(ws.name)).catch(() => undefined)
        if (documentId) documentAPI.getDocument(documentId).then(setDoc).catch(() => undefined)
    }, [user, workspaceId, documentId])

    const loadGraph = useCallback(
        () =>
            graphAPI
                .getGraph(scope === "document" && documentId ? documentId : undefined)
                .then(({ nodes, edges }) => {
                    setNodes(nodes)
                    setEdges(edges)
                })
                .catch(() => undefined)
                .finally(() => setReady(true)),
        [scope, documentId]
    )

    const loadStatus = useCallback(() => {
        if (!documentId) return Promise.resolve()
        return graphAPI.getExtractionStatus(documentId).then(setExtraction).catch(() => undefined)
    }, [documentId])

    useEffect(() => {
        if (!user) return
        loadGraph()
        loadStatus()
    }, [user, loadGraph, loadStatus])

    const jobStatus = extraction?.job?.status
    const docProcessing = extraction ? extraction.documentStatus === "UPLOADED" || extraction.documentStatus === "PROCESSING" : false
    const extracting = jobStatus === "PENDING" || jobStatus === "RUNNING"
    // Without a document to watch, fall back to re-checking an empty graph.
    const shouldPoll = documentId ? docProcessing || extracting : ready && nodes.length === 0
    useEffect(() => {
        if (!user || !shouldPoll) return
        const timer = setInterval(() => {
            loadStatus()
            loadGraph()
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [user, shouldPoll, loadStatus, loadGraph])

    // One last fetch when a run finishes, so the final windows' edges are not missed.
    useEffect(() => {
        if (jobStatus === "DONE" || jobStatus === "DEAD") loadGraph()
    }, [jobStatus, loadGraph])

    const handleExtract = async () => {
        if (!documentId) return
        setRequesting(true)
        setRequestError(null)
        try {
            await graphAPI.requestExtraction(documentId)
            await loadStatus()
        } catch (err) {
            setRequestError(err instanceof Error ? err.message : String(err))
        } finally {
            setRequesting(false)
        }
    }

    const handleNodeClick = async (id: string) => {
        const entityDetail = await graphAPI.getEntity(id)
        setDetail(entityDetail)
    }

    const handleViewModeChange = (mode: ViewMode) => {
        if (mode === "graph" || !documentId) return
        router.push(`/workspace/${workspaceId}/book/${documentId}?view=${mode}`)
    }

    if (loading || !user) return <FullScreenSpinner />

    const breadcrumbs: Crumb[] = [
        { label: workspaceName ?? t("library.workspace"), href: "/library", kind: "workspace" },
        ...(documentId
            ? [{ label: doc?.title ?? "…", href: `/workspace/${workspaceId}/book/${documentId}`, kind: "document" as const }]
            : []),
        { label: t("graph.title") },
    ]

    const emptyMessage =
        scope === "document" && (docProcessing || extracting) ? t("graph.emptyExtracting") : scope === "document" ? t("graph.emptyDocument") : t("graph.empty")

    return (
        <div className="flex h-screen flex-col bg-background">
            <Header
                breadcrumbs={breadcrumbs}
                // Without a book to return to, the reading/chat modes have nowhere to go.
                viewMode={documentId ? "graph" : undefined}
                onViewModeChange={documentId ? handleViewModeChange : undefined}
            />

            {documentId && (
                <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-3 py-2 sm:px-5">
                    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
                        <ScopeButton active={scope === "document"} onClick={() => setScope("document")}>{t("graph.scope.document")}</ScopeButton>
                        <ScopeButton active={scope === "all"} onClick={() => setScope("all")}>{t("graph.scope.all")}</ScopeButton>
                    </div>
                    <ExtractionBar
                        extraction={extraction}
                        docProcessing={docProcessing}
                        requesting={requesting}
                        requestError={requestError}
                        onExtract={handleExtract}
                    />
                </div>
            )}

            <div className="relative flex-1">
                {!ready ? (
                    <div className="h-full flex items-center justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                ) : nodes.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
                        {scope === "document" && (docProcessing || extracting) ? (
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        ) : (
                            <Network className="w-10 h-10" />
                        )}
                        <p className="text-sm max-w-sm">{emptyMessage}</p>
                    </div>
                ) : (
                    <GraphCanvas nodes={nodes} edges={edges} onNodeClick={handleNodeClick} />
                )}

                {detail && <EntityDetailPanel detail={detail} onClose={() => setDetail(null)} />}
            </div>
        </div>
    )
}

function ExtractionBar({
    extraction,
    docProcessing,
    requesting,
    requestError,
    onExtract,
}: {
    extraction: ExtractionStatus | null
    docProcessing: boolean
    requesting: boolean
    requestError: string | null
    onExtract: () => void
}) {
    const { t } = useI18n()
    if (!extraction) return null

    const job = extraction.job
    const count = extraction.relationCount
    let icon = <Network className="w-3.5 h-3.5 flex-shrink-0" />
    let message: string
    let tone = "text-muted-foreground"
    let action: string | null = null

    if (docProcessing) {
        icon = <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
        message = t("graph.status.documentProcessing")
        tone = "text-primary"
    } else if (job?.status === "RUNNING" || job?.status === "PENDING") {
        icon = <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
        message = job.status === "PENDING" && job.error ? t("graph.status.retrying") : t("graph.status.running").replace("{count}", String(count))
        tone = "text-primary"
    } else if (job?.status === "DEAD" || job?.status === "FAILED") {
        icon = <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        message = t("graph.status.failed")
        tone = "text-destructive"
        action = t("common.retry")
    } else if (job?.status === "DONE") {
        icon = <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
        message = t("graph.status.done").replace("{count}", String(count))
        action = t("graph.action.reextract")
    } else {
        message = t("graph.status.none")
        action = t("graph.action.extract")
    }

    const error = requestError ?? (job?.status !== "DONE" ? job?.error : null)

    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn("flex items-center gap-1.5 text-xs", tone)}>
                {icon}
                {message}
            </span>
            {action && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onExtract} disabled={requesting}>
                    {requesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {action}
                </Button>
            )}
            {error && (
                <span className="w-full truncate text-[11px] text-muted-foreground" title={error}>
                    {error}
                </span>
            )}
        </div>
    )
}

function ScopeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
        >
            {children}
        </button>
    )
}

function FullScreenSpinner() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
    )
}
