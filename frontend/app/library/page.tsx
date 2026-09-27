"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Network, Plus, Loader2, FolderOpen, ChevronDown, Library } from "lucide-react"
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
            <Header breadcrumbs={activeWorkspace ? [{ label: activeWorkspace.name, kind: "workspace" }] : []} />

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                        <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <Library className="w-3.5 h-3.5" /> {t("library.title")}
                            </p>
                            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground truncate">
                                {activeWorkspace?.name ?? t("library.workspace")}
                            </h2>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                {t("library.documents").replace("{count}", String(documents.length))}
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <label className="relative flex items-center">
                                <span className="sr-only">{t("library.workspace")}</span>
                                <FolderOpen className="pointer-events-none absolute left-2.5 w-4 h-4 text-muted-foreground" />
                                <select
                                    value={activeWorkspaceId}
                                    onChange={(e) => handleSelectWorkspace(e.target.value)}
                                    className="h-9 min-w-[200px] max-w-[280px] appearance-none truncate rounded-md border border-input bg-card pl-8 pr-8 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring/40"
                                >
                                    {workspaces.length === 0 && <option value="">—</option>}
                                    {workspaces.map((w) => (
                                        <option key={w.id} value={w.id}>{w.name} ({w.document_count})</option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-2.5 w-4 h-4 text-muted-foreground" />
                            </label>
                            <Button variant="outline" size="sm" className="h-9" onClick={handleCreateWorkspace} disabled={creatingWorkspace}>
                                <Plus className="w-4 h-4" /> {t("library.newWorkspace")}
                            </Button>
                            {activeWorkspaceId && (
                                <Button variant="outline" size="sm" className="h-9" onClick={() => router.push(`/workspace/${activeWorkspaceId}/graph`)}>
                                    <Network className="w-4 h-4" /> {t("nav.graph")}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="mb-8">
                        <UploadDropzone onFileSelected={handleUpload} disabled={!activeWorkspaceId || uploading} uploading={uploading} />
                    </div>

                    {documents.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-12">{t("library.empty")}</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
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
