"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { DocumentViewer } from "@/components/document-viewer"
import { ChatPanel } from "@/components/chat-panel"
import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { useAuth } from "@/lib/auth-context"
import { workspaceAPI, Workspace } from "@/lib/api/workspaces"
import { Loader2 } from "lucide-react"

export default function Home() {
    const { user, loading } = useAuth()
    const router = useRouter()

    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("")
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
    const [selectedDocumentId, setSelectedDocumentId] = useState<string>("")
    const [selectedText, setSelectedText] = useState<string>("")

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        if (!selectedWorkspaceId) {
            setSelectedWorkspace(null)
            return
        }
        workspaceAPI.getWorkspace(selectedWorkspaceId)
            .then(setSelectedWorkspace)
            .catch(() => null)
    }, [selectedWorkspaceId])

    const handleWorkspaceSelect = (workspaceId: string) => {
        setSelectedWorkspaceId(workspaceId)
        setSelectedDocumentId("")
        setSelectedText("")
    }

    const handleDocumentSelect = (documentId: string, workspaceId: string) => {
        setSelectedDocumentId(documentId)
        setSelectedText("")
        if (workspaceId && workspaceId !== selectedWorkspaceId) {
            setSelectedWorkspaceId(workspaceId)
        }
    }

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
                {/* Sidebar — desktop */}
                <div className={`${sidebarOpen ? "w-64" : "w-0"} hidden md:flex flex-col transition-all duration-300 border-r border-border bg-sidebar overflow-hidden flex-shrink-0`}>
                    {sidebarOpen && (
                        <Sidebar
                            onDocumentSelect={handleDocumentSelect}
                            onWorkspaceSelect={handleWorkspaceSelect}
                            selectedDocumentId={selectedDocumentId}
                            selectedWorkspaceId={selectedWorkspaceId}
                        />
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

                    {/* Chat panel */}
                    <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col overflow-hidden">
                        <ChatPanel
                            workspaceId={selectedWorkspaceId || undefined}
                            documentId={selectedDocumentId || undefined}
                            selectedText={selectedText}
                            onClearSelection={() => setSelectedText("")}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
