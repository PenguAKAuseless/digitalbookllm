"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { Header, ViewMode } from "@/components/layout/header"
import { VirtualPageViewer, OutlineEntry } from "@/components/reader/virtual-page-viewer"
import { TextPageViewer } from "@/components/reader/text-page-viewer"
import { SelectionPopover, SelectionInfo } from "@/components/reader/selection-popover"
import { ReaderSidebar } from "@/components/reader/reader-sidebar"
import { ChatPanel } from "@/components/chat/chat-panel"
import { documentAPI, DocumentDetail } from "@/lib/api/documents"
import { workspaceAPI } from "@/lib/api/workspaces"
import { highlightAPI, Highlight } from "@/lib/api/highlights"
import { Citation } from "@/lib/api/rag"
import { speak } from "@/lib/tts"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

const PROGRESS_SAVE_DEBOUNCE_MS = 2000

export default function ReaderPage() {
    const { workspaceId, documentId } = useParams<{ workspaceId: string; documentId: string }>()
    const router = useRouter()
    const searchParams = useSearchParams()
    const { user, loading } = useAuth()
    const { t, lang } = useI18n()

    const [doc, setDoc] = useState<DocumentDetail | null>(null)
    const [file, setFile] = useState<{ url: string; fileType: string } | null>(null)
    const [workspaceName, setWorkspaceName] = useState<string | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [highlights, setHighlights] = useState<Highlight[]>([])
    const [outline, setOutline] = useState<OutlineEntry[]>([])
    const [jumpToPage, setJumpToPage] = useState<number | null>(null)
    const [selection, setSelection] = useState<SelectionInfo | null>(null)
    const [chatSelectedText, setChatSelectedText] = useState("")
    const [askSignal, setAskSignal] = useState(0)
    // Coming back from the graph page restores the mode the reader was in.
    const [viewMode, setViewMode] = useState<ViewMode>(() => (searchParams.get("view") === "reading" ? "reading" : "split"))
    // A citation from the knowledge graph opens the book at its page instead of the last-read one.
    const citedPage = Number(searchParams.get("page")) || null
    const [sidebarOpen, setSidebarOpen] = useState(false)
    // Phones get the book on top and the chat below instead of two cramped columns.
    const [isNarrow, setIsNarrow] = useState(false)
    useEffect(() => {
        const query = window.matchMedia("(max-width: 767px)")
        const update = () => setIsNarrow(query.matches)
        update()
        query.addEventListener("change", update)
        return () => query.removeEventListener("change", update)
    }, [])

    const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        if (!documentId || !user) return
        // Fetched in parallel; a failure must surface instead of leaving the spinner up forever.
        Promise.all([documentAPI.getDocument(documentId), documentAPI.getFileUrl(documentId)])
            .then(([detail, fileInfo]) => {
                setDoc(detail)
                setFile(fileInfo)
            })
            .catch((err: Error) => setLoadError(err.message))
        highlightAPI.list(documentId).then(setHighlights).catch(() => undefined)
    }, [documentId, user])

    // Opened while ingestion is still running: poll until the AI side is ready.
    const isProcessing = doc ? doc.status === "UPLOADED" || doc.status === "PROCESSING" : false
    useEffect(() => {
        if (!isProcessing) return
        const timer = setInterval(async () => {
            const status = await documentAPI.getStatus(documentId).catch(() => null)
            if (status && status.status !== "UPLOADED" && status.status !== "PROCESSING") {
                documentAPI.getDocument(documentId).then(setDoc).catch(() => undefined)
            }
        }, 3000)
        return () => clearInterval(timer)
    }, [isProcessing, documentId])

    useEffect(() => {
        if (!workspaceId || !user) return
        // Returning to the library should land on the workspace this book belongs to.
        localStorage.setItem("dbllm-active-workspace", workspaceId)
        workspaceAPI.getWorkspace(workspaceId).then((ws) => setWorkspaceName(ws.name)).catch(() => undefined)
    }, [workspaceId, user])

    const handlePageChange = useCallback(
        (page: number) => {
            if (progressTimer.current) clearTimeout(progressTimer.current)
            progressTimer.current = setTimeout(() => {
                documentAPI.updateProgress(documentId, page).catch(() => undefined)
            }, PROGRESS_SAVE_DEBOUNCE_MS)
        },
        [documentId]
    )

    const clearBrowserSelection = () => {
        window.getSelection()?.removeAllRanges()
        setSelection(null)
    }

    const handleHighlight = async (color: string) => {
        if (!selection) return
        const created = await highlightAPI.create(documentId, {
            type: "HIGHLIGHT",
            content: selection.text,
            color,
            locationMeta: { page: selection.page, rects: selection.rects },
        })
        setHighlights((prev) => [...prev, created])
        clearBrowserSelection()
    }

    const handleNote = async (note: string) => {
        if (!selection) return
        const created = await highlightAPI.create(documentId, {
            type: "HIGHLIGHT",
            content: selection.text,
            note,
            color: "#fde047",
            locationMeta: { page: selection.page, rects: selection.rects },
        })
        setHighlights((prev) => [...prev, created])
        clearBrowserSelection()
    }

    const handleSpeak = () => {
        if (!selection) return
        speak(selection.text, lang)
        clearBrowserSelection()
    }

    const handleAskAI = () => {
        if (!selection) return
        setChatSelectedText(selection.text)
        setAskSignal((n) => n + 1)
        clearBrowserSelection()
        if (viewMode === "reading") setViewMode("split")
    }

    const handleDeleteHighlight = async (id: string) => {
        await highlightAPI.remove(documentId, id)
        setHighlights((prev) => prev.filter((h) => h.id !== id))
    }

    const handleCitationClick = (citation: Citation) => {
        if (citation.page) setJumpToPage(citation.page)
    }

    const handleViewModeChange = (mode: ViewMode) => {
        // Carry the open book along so the graph page can route straight back to it.
        if (mode === "graph") router.push(`/workspace/${workspaceId}/graph?doc=${documentId}&view=${viewMode}`)
        else setViewMode(mode)
    }

    if (loadError) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
                <AlertTriangle className="w-8 h-8 text-destructive" />
                <p className="text-sm font-medium">{t("common.error")}</p>
                <p className="text-xs text-muted-foreground max-w-sm">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => router.push("/library")}>{t("nav.library")}</Button>
            </div>
        )
    }

    if (loading || !user || !doc || !file) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    const isPdf = file.fileType === "application/pdf" || doc.title.toLowerCase().endsWith(".pdf")

    const readerPane = (
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
            {isProcessing && (
                <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-primary/5 px-4 py-2 text-xs text-primary">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    <span>{t("reader.processingBanner")}</span>
                </div>
            )}
            {isPdf ? (
                <VirtualPageViewer
                    fileUrl={file.url}
                    highlights={highlights}
                    initialPage={citedPage ?? doc.last_read_page}
                    jumpToPage={jumpToPage}
                    onDocumentLoad={({ outline }) => setOutline(outline)}
                    onPageChange={handlePageChange}
                    onSelectionChange={setSelection}
                />
            ) : (
                <TextPageViewer
                    text={doc.full_text ?? ""}
                    highlights={highlights}
                    initialPage={citedPage ?? doc.last_read_page}
                    jumpToPage={jumpToPage}
                    onPageChange={handlePageChange}
                    onSelectionChange={setSelection}
                />
            )}
            {selection && (
                <SelectionPopover
                    selection={selection}
                    onHighlight={handleHighlight}
                    onNote={handleNote}
                    onSpeak={handleSpeak}
                    onAskAI={handleAskAI}
                />
            )}
        </div>
    )

    return (
        <div className="flex h-screen flex-col bg-background overflow-hidden">
            <Header
                onMenuClick={() => setSidebarOpen((v) => !v)}
                breadcrumbs={[
                    { label: workspaceName ?? t("library.workspace"), href: "/library", kind: "workspace" },
                    { label: doc.title, kind: "document" },
                ]}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
            />

            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className={`${sidebarOpen ? "flex" : "hidden"} md:flex w-64 flex-shrink-0 border-r border-border bg-sidebar min-h-0`}>
                    <ReaderSidebar
                        outline={outline}
                        highlights={highlights}
                        onJumpToPage={setJumpToPage}
                        onDeleteHighlight={handleDeleteHighlight}
                    />
                </div>

                {viewMode === "split" ? (
                    <PanelGroup key={isNarrow ? "v" : "h"} direction={isNarrow ? "vertical" : "horizontal"} className="flex-1 min-w-0">
                        <Panel defaultSize={isNarrow ? 60 : 65} minSize={isNarrow ? 25 : 35}>
                            {readerPane}
                        </Panel>
                        <PanelResizeHandle className="data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full w-px bg-border hover:bg-primary/60 data-[resize-handle-state=drag]:bg-primary transition-colors relative after:absolute after:inset-y-0 after:-left-1 after:-right-1" />
                        <Panel defaultSize={isNarrow ? 40 : 35} minSize={22}>
                            <ChatPanel
                                workspaceId={workspaceId}
                                documentId={documentId}
                                selectedText={chatSelectedText}
                                onClearSelection={() => setChatSelectedText("")}
                                onCitationClick={handleCitationClick}
                                askSignal={askSignal}
                            />
                        </Panel>
                    </PanelGroup>
                ) : (
                    readerPane
                )}
            </div>
        </div>
    )
}
