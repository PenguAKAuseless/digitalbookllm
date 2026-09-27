"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { Header, ViewMode } from "@/components/layout/header"
import { VirtualPageViewer, OutlineEntry } from "@/components/reader/virtual-page-viewer"
import { SelectionPopover, SelectionInfo } from "@/components/reader/selection-popover"
import { ReaderSidebar } from "@/components/reader/reader-sidebar"
import { ChatPanel } from "@/components/chat/chat-panel"
import { documentAPI, DocumentDetail } from "@/lib/api/documents"
import { highlightAPI, Highlight } from "@/lib/api/highlights"
import { Citation } from "@/lib/api/rag"
import { speak } from "@/lib/tts"
import { Loader2 } from "lucide-react"

const PROGRESS_SAVE_DEBOUNCE_MS = 2000

export default function ReaderPage() {
    const { workspaceId, documentId } = useParams<{ workspaceId: string; documentId: string }>()
    const router = useRouter()
    const { user, loading } = useAuth()
    const { t, lang } = useI18n()

    const [doc, setDoc] = useState<DocumentDetail | null>(null)
    const [fileUrl, setFileUrl] = useState<string | null>(null)
    const [highlights, setHighlights] = useState<Highlight[]>([])
    const [outline, setOutline] = useState<OutlineEntry[]>([])
    const [jumpToPage, setJumpToPage] = useState<number | null>(null)
    const [selection, setSelection] = useState<SelectionInfo | null>(null)
    const [chatSelectedText, setChatSelectedText] = useState("")
    const [askSignal, setAskSignal] = useState(0)
    const [viewMode, setViewMode] = useState<ViewMode>("split")
    const [sidebarOpen, setSidebarOpen] = useState(false)

    const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        if (!documentId) return
        documentAPI.getDocument(documentId).then(setDoc)
        documentAPI.getFileUrl(documentId).then((res) => setFileUrl(res.url))
        highlightAPI.list(documentId).then(setHighlights)
    }, [documentId])

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
        if (mode === "graph") router.push(`/workspace/${workspaceId}/graph`)
        else setViewMode(mode)
    }

    if (loading || !user || !doc || !fileUrl) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    const readerPane = (
        <div className="relative flex-1 flex min-h-0">
            <VirtualPageViewer
                fileUrl={fileUrl}
                highlights={highlights}
                initialPage={doc.last_read_page}
                jumpToPage={jumpToPage}
                onDocumentLoad={({ outline }) => setOutline(outline)}
                onPageChange={handlePageChange}
                onSelectionChange={setSelection}
            />
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
                breadcrumb={doc.title}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
            />

            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className={`${sidebarOpen ? "flex" : "hidden"} md:flex w-64 flex-shrink-0 border-r border-border bg-sidebar`}>
                    <ReaderSidebar
                        outline={outline}
                        highlights={highlights}
                        onJumpToPage={setJumpToPage}
                        onDeleteHighlight={handleDeleteHighlight}
                    />
                </div>

                {viewMode === "split" ? (
                    <PanelGroup direction="horizontal" className="flex-1 min-w-0">
                        <Panel defaultSize={65} minSize={35}>
                            {readerPane}
                        </Panel>
                        <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/40 transition-colors" />
                        <Panel defaultSize={35} minSize={22}>
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
