"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { DocumentViewer } from "@/components/document-viewer"
import { ChatPanel } from "@/components/chat-panel"
import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { QuizPanel } from "@/components/quiz-panel"
import { useAuth } from "@/lib/auth-context"
import { workspaceAPI, Workspace } from "@/lib/api/workspaces"
import { documentAPI, Document } from "@/lib/api/documents"
import { Loader2, GripVertical } from "lucide-react"

export default function Home() {
    const { user, loading } = useAuth()
    const router = useRouter()

    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [sidebarWidth, setSidebarWidth] = useState(256)
    const [isResizing, setIsResizing] = useState(false)
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("")
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
    const [selectedDocumentId, setSelectedDocumentId] = useState<string>("")
    const [selectedDocument, setSelectedDocument] = useState<Document | null>(null)
    const [selectedText, setSelectedText] = useState<string>("")
    const [showQuizPanel, setShowQuizPanel] = useState(false)
    const sidebarRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        let cancelled = false
        if (selectedWorkspaceId) {
            workspaceAPI.getWorkspace(selectedWorkspaceId)
                .then(ws => { if (!cancelled) setSelectedWorkspace(ws) })
                .catch(() => { if (!cancelled) setSelectedWorkspace(null) })
        }
        return () => { cancelled = true }
    }, [selectedWorkspaceId])

    useEffect(() => {
        let cancelled = false
        if (selectedDocumentId) {
            documentAPI.getDocument(selectedDocumentId)
                .then(doc => { if (!cancelled) setSelectedDocument(doc) })
                .catch(() => { if (!cancelled) setSelectedDocument(null) })
        }
        return () => { cancelled = true }
    }, [selectedDocumentId])

    const handleWorkspaceSelect = (workspaceId: string) => {
        setSelectedWorkspaceId(workspaceId)
        setSelectedDocumentId("")
        setSelectedDocument(null)
        setSelectedText("")
        setShowQuizPanel(false)
        if (!workspaceId) {
            setSelectedWorkspace(null)
        }
    }

    const handleDocumentSelect = (documentId: string, workspaceId: string) => {
        setSelectedDocumentId(documentId)
        setSelectedText("")
        setShowQuizPanel(false)
        if (!documentId) {
            setSelectedDocument(null)
        }
        if (workspaceId && workspaceId !== selectedWorkspaceId) {
            setSelectedWorkspaceId(workspaceId)
        }
    }

    const startResizing = useCallback((e: React.MouseEvent) => {
        setIsResizing(true)
        e.preventDefault()
    }, [])

    const stopResizing = useCallback(() => {
        setIsResizing(false)
    }, [])

    const resize = useCallback((e: MouseEvent) => {
        if (!isResizing) return
        const newWidth = e.clientX
        if (newWidth >= 200 && newWidth <= 400) {
            setSidebarWidth(newWidth)
        }
    }, [isResizing])

    useEffect(() => {
        if (isResizing) {
            window.addEventListener("mousemove", resize)
            window.addEventListener("mouseup", stopResizing)
        }
        return () => {
            window.removeEventListener("mousemove", resize)
            window.removeEventListener("mouseup", stopResizing)
        }
    }, [isResizing, resize, stopResizing])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!user) return null

    return (
        <div className="flex h-screen flex-col bg-background overflow-hidden">
            <Header
                onMenuClick={() => setSidebarOpen(!sidebarOpen)}
                workspaceName={selectedWorkspace?.name}
            />

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar — desktop with resize handle */}
                <div
                    ref={sidebarRef}
                    className={`${sidebarOpen ? "" : "w-0"} hidden md:flex flex-col transition-all duration-300 border-r border-border bg-sidebar overflow-hidden flex-shrink-0 relative`}
                    style={{ width: sidebarOpen ? sidebarWidth : 0 }}
                >
                    {sidebarOpen && (
                        <>
                            <Sidebar
                                onDocumentSelect={handleDocumentSelect}
                                onWorkspaceSelect={handleWorkspaceSelect}
                                selectedDocumentId={selectedDocumentId}
                                selectedWorkspaceId={selectedWorkspaceId}
                            />
                            {/* Resize handle */}
                            <div
                                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 transition-colors group"
                                onMouseDown={startResizing}
                            >
                                <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <GripVertical className="w-3 h-3 text-muted-foreground" />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Sidebar — mobile overlay */}
                {sidebarOpen && (
                    <div className="fixed inset-0 z-40 md:hidden bg-black/50" onClick={() => setSidebarOpen(false)}>
                        <div className="w-72 h-full bg-sidebar border-r border-border" onClick={(e) => e.stopPropagation()}>
                            <Sidebar
                                onDocumentSelect={(id, wsId) => { handleDocumentSelect(id, wsId); setSidebarOpen(false) }}
                                onWorkspaceSelect={(wsId) => { handleWorkspaceSelect(wsId); setSidebarOpen(false) }}
                                selectedDocumentId={selectedDocumentId}
                                selectedWorkspaceId={selectedWorkspaceId}
                            />
                        </div>
                    </div>
                )}

                {/* Main content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Document viewer */}
                    <div className="flex-1 flex flex-col overflow-hidden border-r border-border min-w-0">
                        <DocumentViewer
                            documentId={selectedDocumentId || undefined}
                            onTextSelect={setSelectedText}
                        />
                    </div>

                    {/* Chat panel or Quiz panel */}
                    <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col overflow-hidden">
                        {showQuizPanel && selectedDocumentId && selectedWorkspaceId ? (
                            <QuizPanel
                                documentId={selectedDocumentId}
                                workspaceId={selectedWorkspaceId}
                                documentName={selectedDocument?.name || "Document"}
                                onClose={() => setShowQuizPanel(false)}
                            />
                        ) : (
                            <ChatPanel
                                workspaceId={selectedWorkspaceId || undefined}
                                documentId={selectedDocumentId || undefined}
                                documentName={selectedDocument?.name}
                                selectedText={selectedText}
                                onClearSelection={() => setSelectedText("")}
                                onOpenQuiz={() => setShowQuizPanel(true)}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
