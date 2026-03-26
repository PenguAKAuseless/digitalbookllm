"use client"

import { FileText, Plus, FolderOpen, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState, useEffect, useRef } from "react"
import { documentAPI, Document } from "@/lib/api/documents"

interface SidebarProps {
  onDocumentSelect?: (documentId: string) => void
  selectedDocumentId?: string
}

export function Sidebar({ onDocumentSelect, selectedDocumentId }: SidebarProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadDocuments()
  }, [])

  const loadDocuments = async () => {
    try {
      setLoading(true)
      setError(null)
      const docs = await documentAPI.getDocuments()
      setDocuments(docs)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load documents'
      setError(message)
      console.error('Failed to load documents:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setUploading(true)
      setError(null)
      const result = await documentAPI.upload(file)
      await loadDocuments()
      if (onDocumentSelect) {
        onDocumentSelect(result.documentId)
      }
    } catch (error: unknown) {
      console.error('Upload failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to upload document. Please try again.'
      setError(message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Upload Section */}
      <div className="p-4 border-b border-sidebar-border">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.ini,.cfg,.conf,.sql,.py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.sass,.java,.c,.cpp,.h,.hpp,.go,.rs,.rb,.php,.sh,.bat,.ps1,.rtf,text/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Upload Document
            </>
          )}
        </Button>
        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* Documents List */}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider px-2 py-2">
            My Documents ({documents.length})
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">No documents yet</p>
              <p className="text-xs text-muted-foreground mt-1">Upload a file to get started</p>
            </div>
          ) : (
            documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onDocumentSelect?.(doc.id)}
                className={`w-full text-left px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors group ${selectedDocumentId === doc.id ? 'bg-sidebar-accent' : ''
                  }`}
              >
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-sidebar-foreground">{doc.name}</p>
                    <p className="text-xs text-sidebar-foreground/60">{formatDate(doc.created_at)}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border space-y-2">
        <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
          <FolderOpen className="w-4 h-4" />
          Manage Library
        </button>
      </div>
    </div>
  )
}
