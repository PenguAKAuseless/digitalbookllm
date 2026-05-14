"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { ZoomIn, ZoomOut, Highlighter, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { documentAPI } from "@/lib/api/documents"
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
}

interface DocumentViewerProps {
    documentId?: string
    onTextSelect?: (text: string) => void
}

export function DocumentViewer({ documentId, onTextSelect }: DocumentViewerProps) {
    const [zoom, setZoom] = useState(100)
    const [documentContent, setDocumentContent] = useState<string>("")
    const [documentName, setDocumentName] = useState<string>("")
    const [documentType, setDocumentType] = useState<string>("")
    const [loading, setLoading] = useState(false)
    const [numPages, setNumPages] = useState<number>(0)
    const [pageNumber, setPageNumber] = useState<number>(1)
    const [pdfUrl, setPdfUrl] = useState<string>("")
    const [pdfError, setPdfError] = useState<string>("")
    const blobUrlRef = useRef<string>("")
    // Stable ref to onTextSelect so handlers don't get recreated
    const onTextSelectRef = useRef(onTextSelect)
    useEffect(() => { onTextSelectRef.current = onTextSelect }, [onTextSelect])

    useEffect(() => {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current)
            blobUrlRef.current = ""
        }
        setDocumentContent("")
        setDocumentName("")
        setDocumentType("")
        setPdfUrl("")
        setPdfError("")
        setPageNumber(1)
        if (!documentId) return

        const loadDocument = async () => {
            try {
                setLoading(true)
                const doc = await documentAPI.getDocument(documentId)
                setDocumentContent(doc.full_text)
                setDocumentName(doc.name)
                setDocumentType(doc.file_type)

                if (doc.file_type === 'application/pdf') {
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
                    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
                    const pdfResp = await fetch(`${apiUrl}/documents/${documentId}/pdf`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                    })
                    if (pdfResp.ok) {
                        const blob = await pdfResp.blob()
                        const url = URL.createObjectURL(blob)
                        blobUrlRef.current = url
                        setPdfUrl(url)
                    } else {
                        setPdfError(`Failed to fetch PDF (HTTP ${pdfResp.status})`)
                    }
                }
            } catch (error) {
                console.error('Failed to load document:', error)
            } finally {
                setLoading(false)
            }
        }

        loadDocument()

        return () => {
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current)
                blobUrlRef.current = ""
            }
        }
    }, [documentId])

    // Capture selection only on mouseup, using stable callback ref (no internal state).
    // This means the parent rerendering does NOT recompute DOM here, so browser selection persists for copy.
    const handleTextSelection = useCallback(() => {
        const text = window.getSelection()?.toString().trim() || ""
        if (text) onTextSelectRef.current?.(text)
    }, [])

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages)
        setPageNumber(1)
        setPdfError("")
    }

    const onDocumentLoadError = (error: Error) => {
        console.error('PDF load error:', error)
        setPdfError(`Failed to load PDF: ${error.message}`)
    }

    // Memoize options to avoid the "Options prop changed" warning + unnecessary reloads
    const pdfOptions = useMemo(() => ({
        cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
        cMapPacked: true,
    }), [])

    const formatDocumentContent = (content: string) => {
        const paragraphs = content.split('\n\n').filter(p => p.trim())
        return paragraphs.map((para, idx) => {
            const isHeading = para.length < 100 && !para.includes('.')
            if (isHeading) {
                return <h2 key={idx} className="text-2xl font-semibold mt-6 mb-3">{para}</h2>
            }
            return <p key={idx} className="leading-relaxed text-justify mb-4 whitespace-pre-wrap">{para}</p>
        })
    }

    const renderPdfViewer = () => (
        <div className="flex flex-col items-center">
            {pdfError ? (
                <div className="p-8 text-center">
                    <div className="bg-destructive/10 text-destructive p-4 rounded-lg mb-4">
                        <p className="font-semibold mb-2">PDF Loading Error</p>
                        <p className="text-sm">{pdfError}</p>
                    </div>
                </div>
            ) : (
                <>
                    <Document
                        file={pdfUrl || undefined}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={onDocumentLoadError}
                        loading={
                            <div className="flex items-center justify-center p-8">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                <span className="ml-2 text-sm text-muted-foreground">Loading PDF...</span>
                            </div>
                        }
                        options={pdfOptions}
                    >
                        <Page
                            pageNumber={pageNumber}
                            scale={zoom / 100}
                            renderTextLayer={true}
                            renderAnnotationLayer={true}
                        />
                    </Document>

                    {numPages > 1 && (
                        <div className="flex items-center gap-4 mt-4 p-2 bg-card rounded-lg border">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                                disabled={pageNumber <= 1}
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-sm font-medium">
                                Page {pageNumber} of {numPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                                disabled={pageNumber >= numPages}
                            >
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    )

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="border-b border-border bg-card px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Zoom:</span>
                    <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(50, z - 10))}>
                        <ZoomOut className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
                    <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(200, z + 10))}>
                        <ZoomIn className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-8 bg-background">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
                            <p className="text-muted-foreground">Loading document...</p>
                        </div>
                    </div>
                ) : !documentId ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center max-w-md">
                            <Highlighter className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                            <h2 className="text-2xl font-semibold mb-2">No Document Selected</h2>
                            <p className="text-muted-foreground">
                                Select a document from the sidebar — or start chatting with your workspace below.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div onMouseUp={handleTextSelection}>
                        <div className="mb-6 pb-4 border-b max-w-4xl mx-auto">
                            <h1 className="text-3xl font-bold">{documentName}</h1>
                            <p className="text-sm text-muted-foreground mt-1">
                                {documentType === 'application/pdf' ? 'PDF Document' : 'Text Document'}
                            </p>
                        </div>

                        {documentType === 'application/pdf' ? renderPdfViewer() : (
                            <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8 text-foreground"
                                 style={{ fontSize: `${zoom}%` }}>
                                <div className="space-y-4">
                                    {formatDocumentContent(documentContent)}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
