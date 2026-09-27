"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Network, Plus, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { Header } from "@/components/layout/header"
import { Button } from "@/components/ui/button"
import { UploadDropzone } from "@/components/library/upload-dropzone"
import { BookCard } from "@/components/library/book-card"
import { workspaceAPI, Workspace } from "@/lib/api/workspaces"
import { documentAPI, Document } from "@/lib/api/documents"

const ACTIVE_STATUSES = new Set(["UPLOADED", "PROCESSING"])
const POLL_INTERVAL_MS = 3000

export default function LibraryPage() {
    const { user, loading } = useAuth()
    const router = useRouter()
    const { t } = useI18n()

    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("")
    const [documents, setDocuments] = useState<Document[]>([])
    const [uploading, setUploading] = useState(false)
    const [creatingWorkspace, setCreatingWorkspace] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        if (!loading && !user) router.replace("/login")
    }, [loading, user, router])

    useEffect(() => {
        if (!user) return
        workspaceAPI.getWorkspaces().then((ws) => {
            setWorkspaces(ws)
            const stored = localStorage.getItem("dbllm-active-workspace")
            const initial = ws.find((w) => w.id === stored)?.id || ws[0]?.id || ""
            setActiveWorkspaceId(initial)
        })
    }, [user])

    const loadDocuments = useCallback(async () => {
        if (!activeWorkspaceId) return setDocuments([])
        const docs = await documentAPI.getDocuments(activeWorkspaceId)
        setDocuments(docs)
    }, [activeWorkspaceId])

    useEffect(() => {
        loadDocuments()
    }, [loadDocuments])

    // Poll ingestion status while any document is still UPLOADED/PROCESSING (UC07 progress feedback).
    useEffect(() => {
        if (pollRef.current) clearInterval(pollRef.current)
        const hasActive = documents.some((d) => ACTIVE_STATUSES.has(d.status))
        if (!hasActive) return

        pollRef.current = setInterval(async () => {
            const updated = await Promise.all(
                documents.map(async (doc) => {
                    if (!ACTIVE_STATUSES.has(doc.status)) return doc
                    const status = await documentAPI.getStatus(doc.id).catch(() => null)
                    return status ? { ...doc, status: status.status, page_count: status.page_count ?? doc.page_count } : doc
                })
            )
            setDocuments(updated)
        }, POLL_INTERVAL_MS)

        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documents.map((d) => d.status).join(",")])

    const handleSelectWorkspace = (id: string) => {
        setActiveWorkspaceId(id)
        localStorage.setItem("dbllm-active-workspace", id)
    }

    const handleCreateWorkspace = async () => {
        const name = window.prompt(t("library.newWorkspace"))
        if (!name?.trim()) return
        setCreatingWorkspace(true)
        try {
            const ws = await workspaceAPI.createWorkspace(name.trim())
            setWorkspaces((prev) => [ws, ...prev])
            handleSelectWorkspace(ws.id)
        } finally {
            setCreatingWorkspace(false)
        }
    }

    const handleUpload = async (file: File) => {
        if (!activeWorkspaceId) return
        setUploading(true)
        try {
            const result = await documentAPI.upload(file, activeWorkspaceId)
            setDocuments((prev) => [
                { id: result.documentId, title: file.name, author: null, file_type: file.type, file_size: file.size,
                  status: result.status as Document["status"], page_count: null, cover_key: null, last_read_page: 1,
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                ...prev,
            ])
        } finally {
            setUploading(false)
        }
    }

    const handleDelete = async (id: string) => {
        await documentAPI.deleteDocument(id)
        setDocuments((prev) => prev.filter((d) => d.id !== id))
    }

    if (loading || !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)

    return (
        <div className="flex h-screen flex-col bg-background">
            <Header breadcrumb={activeWorkspace?.name} />

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6">
                    <div className="flex flex-wrap items-center gap-2 mb-6">
                        <select
                            value={activeWorkspaceId}
                            onChange={(e) => handleSelectWorkspace(e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {workspaces.length === 0 && <option value="">—</option>}
                            {workspaces.map((w) => (
                                <option key={w.id} value={w.id}>{w.name} ({w.document_count})</option>
                            ))}
                        </select>
                        <Button variant="outline" size="sm" onClick={handleCreateWorkspace} disabled={creatingWorkspace}>
                            <Plus className="w-4 h-4" /> {t("library.newWorkspace")}
                        </Button>
                        {activeWorkspaceId && (
                            <Button variant="outline" size="sm" onClick={() => router.push(`/workspace/${activeWorkspaceId}/graph`)}>
                                <Network className="w-4 h-4" /> {t("nav.graph")}
                            </Button>
                        )}
                    </div>

                    <div className="mb-6">
                        <UploadDropzone onFileSelected={handleUpload} disabled={!activeWorkspaceId || uploading} />
                    </div>

                    {documents.length === 0 ? (
                        <p className="text-center text-muted-foreground py-12">{t("library.empty")}</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {documents.map((doc) => (
                                <BookCard
                                    key={doc.id}
                                    document={doc}
                                    onOpen={() => router.push(`/workspace/${activeWorkspaceId}/book/${doc.id}`)}
                                    onDelete={() => handleDelete(doc.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
