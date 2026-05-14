"use client"

import {
    FileText, Plus, Loader2, Trash2, ChevronDown, ChevronRight,
    FolderOpen, FolderPlus, Edit2, Check, X
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { workspaceAPI, Workspace } from "@/lib/api/workspaces"
import { documentAPI, Document } from "@/lib/api/documents"

interface SidebarProps {
    onDocumentSelect?: (documentId: string, workspaceId: string) => void
    onWorkspaceSelect?: (workspaceId: string) => void
    selectedDocumentId?: string
    selectedWorkspaceId?: string
}

export function Sidebar({ onDocumentSelect, onWorkspaceSelect, selectedDocumentId, selectedWorkspaceId }: SidebarProps) {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [documents, setDocuments] = useState<Document[]>([])
    const [wsLoading, setWsLoading] = useState(true)
    const [docLoading, setDocLoading] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Workspace creation
    const [creatingWs, setCreatingWs] = useState(false)
    const [newWsName, setNewWsName] = useState("")
    const [savingWs, setSavingWs] = useState(false)

    // Workspace rename
    const [renamingWsId, setRenamingWsId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState("")

    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        loadWorkspaces()
    }, [])

    useEffect(() => {
        if (selectedWorkspaceId) loadDocuments(selectedWorkspaceId)
    }, [selectedWorkspaceId])

    const loadWorkspaces = async () => {
        try {
            setWsLoading(true)
            setError(null)
            const list = await workspaceAPI.getWorkspaces()
            setWorkspaces(list)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load workspaces")
        } finally {
            setWsLoading(false)
        }
    }

    const loadDocuments = async (workspaceId: string) => {
        try {
            setDocLoading(true)
            setError(null)
            const docs = await documentAPI.getDocuments(workspaceId)
            setDocuments(docs)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load documents")
        } finally {
            setDocLoading(false)
        }
    }

    const handleCreateWorkspace = async () => {
        if (!newWsName.trim()) return
        setSavingWs(true)
        try {
            const ws = await workspaceAPI.createWorkspace(newWsName.trim())
            setWorkspaces((prev) => [ws, ...prev])
            setNewWsName("")
            setCreatingWs(false)
            handleSelectWorkspace(ws.id)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create workspace")
        } finally {
            setSavingWs(false)
        }
    }

    const handleRenameWorkspace = async (id: string) => {
        if (!renameValue.trim()) return
        try {
            const updated = await workspaceAPI.updateWorkspace(id, renameValue.trim())
            setWorkspaces((prev) => prev.map((w) => (w.id === id ? updated : w)))
            setRenamingWsId(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to rename workspace")
        }
    }

    const handleDeleteWorkspace = async (id: string) => {
        if (!confirm("Delete this workspace and all its documents?")) return
        try {
            await workspaceAPI.deleteWorkspace(id)
            setWorkspaces((prev) => prev.filter((w) => w.id !== id))
            if (selectedWorkspaceId === id) {
                onWorkspaceSelect?.("")
                setDocuments([])
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete workspace")
        }
    }

    const handleSelectWorkspace = (id: string) => {
        onWorkspaceSelect?.(id)
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !selectedWorkspaceId) return

        try {
            setUploading(true)
            setError(null)
            const result = await documentAPI.upload(file, selectedWorkspaceId)
            await loadDocuments(selectedWorkspaceId)
            onDocumentSelect?.(result.documentId, selectedWorkspaceId)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed")
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ""
        }
    }

    const handleDeleteDocument = async (docId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm("Delete this document?")) return
        try {
            await documentAPI.deleteDocument(docId)
            setDocuments((prev) => prev.filter((d) => d.id !== docId))
            if (selectedDocumentId === docId) onDocumentSelect?.("", selectedWorkspaceId || "")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete document")
        }
    }

    const formatDate = (s: string) => {
        const d = new Date(s), now = new Date()
        const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
        if (days === 0) return "Today"
        if (days === 1) return "Yesterday"
        if (days < 7) return `${days}d ago`
        return d.toLocaleDateString()
    }

    const fileIcon = (type: string) => {
        if (type === "application/pdf") return "PDF"
        if (type.includes("word")) return "DOC"
        return "TXT"
    }

    return (
        <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
            {/* Workspaces */}
            <div className="p-3 border-b border-sidebar-border">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider">Workspaces</span>
                    <button
                        onClick={() => { setCreatingWs(true); setNewWsName("") }}
                        className="p-1 rounded hover:bg-sidebar-accent transition-colors"
                        title="New workspace"
                    >
                        <FolderPlus className="w-4 h-4" />
                    </button>
                </div>

                {creatingWs && (
                    <div className="flex gap-1 mb-2">
                        <input
                            autoFocus
                            value={newWsName}
                            onChange={(e) => setNewWsName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreateWorkspace(); if (e.key === "Escape") setCreatingWs(false) }}
                            placeholder="Workspace name"
                            className="flex-1 px-2 py-1 text-xs rounded bg-input border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button onClick={handleCreateWorkspace} disabled={savingWs} className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90">
                            {savingWs ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </button>
                        <button onClick={() => setCreatingWs(false)} className="p-1 rounded hover:bg-sidebar-accent">
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                )}

                {wsLoading ? (
                    <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : workspaces.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">No workspaces yet. Create one above.</p>
                ) : (
                    <div className="space-y-0.5">
                        {workspaces.map((ws) => (
                            <div key={ws.id} className={`group rounded-lg ${selectedWorkspaceId === ws.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"} transition-colors`}>
                                {renamingWsId === ws.id ? (
                                    <div className="flex gap-1 p-1">
                                        <input
                                            autoFocus
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") handleRenameWorkspace(ws.id); if (e.key === "Escape") setRenamingWsId(null) }}
                                            className="flex-1 px-2 py-1 text-xs rounded bg-input border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        <button onClick={() => handleRenameWorkspace(ws.id)} className="p-1 rounded bg-primary text-primary-foreground"><Check className="w-3 h-3" /></button>
                                        <button onClick={() => setRenamingWsId(null)} className="p-1 rounded hover:bg-sidebar-accent"><X className="w-3 h-3" /></button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => handleSelectWorkspace(ws.id)}
                                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectWorkspace(ws.id) }}
                                        role="button"
                                        tabIndex={0}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer"
                                    >
                                        <FolderOpen className="w-4 h-4 flex-shrink-0 text-primary" />
                                        <span className="flex-1 text-sm truncate">{ws.name}</span>
                                        <span className="text-xs text-muted-foreground">{ws.document_count}</span>
                                        <div className="hidden group-hover:flex gap-0.5">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); setRenamingWsId(ws.id); setRenameValue(ws.name) }}
                                                className="p-0.5 rounded hover:bg-background/50"
                                            ><Edit2 className="w-3 h-3" /></button>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws.id) }}
                                                className="p-0.5 rounded hover:bg-destructive/20 text-destructive"
                                            ><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Documents */}
            {selectedWorkspaceId && (
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="p-3 border-b border-sidebar-border">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.ini,.cfg,.conf,.sql,.py,.js,.ts,.tsx,.jsx,.html,.css,.rtf,text/*"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        >
                            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading...</> : <><Plus className="w-4 h-4" />Upload Document</>}
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3">
                        <h3 className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider mb-2 px-1">
                            Documents {documents.length > 0 && `(${documents.length})`}
                        </h3>

                        {docLoading ? (
                            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                        ) : documents.length === 0 ? (
                            <div className="text-center py-8">
                                <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-40" />
                                <p className="text-xs text-muted-foreground">No documents yet</p>
                                <p className="text-xs text-muted-foreground mt-1">Upload a file to start</p>
                            </div>
                        ) : (
                            <div className="space-y-0.5">
                                {documents.map((doc) => (
                                    <div
                                        key={doc.id}
                                        className={`group flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${selectedDocumentId === doc.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"}`}
                                        onClick={() => onDocumentSelect?.(doc.id, selectedWorkspaceId)}
                                    >
                                        <span className="text-xs font-bold text-primary bg-primary/10 px-1 rounded mt-0.5 flex-shrink-0">
                                            {fileIcon(doc.file_type)}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{doc.name}</p>
                                            <p className="text-xs text-muted-foreground">{formatDate(doc.created_at)}</p>
                                        </div>
                                        <button
                                            onClick={(e) => handleDeleteDocument(doc.id, e)}
                                            className="hidden group-hover:flex p-0.5 rounded hover:bg-destructive/20 text-destructive flex-shrink-0"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {!selectedWorkspaceId && !wsLoading && workspaces.length > 0 && (
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-xs text-muted-foreground text-center">Select a workspace to view documents</p>
                </div>
            )}

            {error && (
                <div className="p-3 border-t border-sidebar-border">
                    <p className="text-xs text-destructive">{error}</p>
                </div>
            )}
        </div>
    )
}
