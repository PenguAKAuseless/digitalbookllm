"use client"

import { useState, useEffect } from "react"
import { ZoomIn, ZoomOut, Download, Share2, Highlighter, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { documentAPI } from "@/lib/api/documents"
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure PDF.js worker with fallback
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
}

interface DocumentViewerProps {
  documentId?: string
  onTextSelect?: (text: string) => void
}

export function DocumentViewer({ documentId, onTextSelect }: DocumentViewerProps) {
  const [zoom, setZoom] = useState(100)
  const [selectedText, setSelectedText] = useState("")
  const [documentContent, setDocumentContent] = useState<string>("")
  const [documentName, setDocumentName] = useState<string>("")
  const [documentType, setDocumentType] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [numPages, setNumPages] = useState<number>(0)
  const [pageNumber, setPageNumber] = useState<number>(1)
  const [pdfUrl, setPdfUrl] = useState<string>("")
  const [pdfError, setPdfError] = useState<string>("")

  useEffect(() => {
    if (documentId) {
      loadDocument()
    }
  }, [documentId])

  const loadDocument = async () => {
    if (!documentId) return

    try {
      setLoading(true)
      const doc = await documentAPI.getDocument(documentId)
      setDocumentContent(doc.full_text)
      setDocumentName(doc.name)
      setDocumentType(doc.file_type)

      // If it's a PDF, set the URL to fetch it
      if (doc.file_type === 'application/pdf') {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
        const pdfEndpoint = `${apiUrl}/documents/${documentId}/pdf`
        console.log('PDF URL:', pdfEndpoint)
        setPdfUrl(pdfEndpoint)
      }
    } catch (error) {
      console.error('Failed to load document:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTextSelection = () => {
    const selection = window.getSelection()
    if (selection) {
      const text = selection.toString().trim()
      setSelectedText(text)
      if (text && onTextSelect) {
        onTextSelect(text)
      }
    }
  }

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages)
    setPageNumber(1)
    setPdfError("")
  }

  const onDocumentLoadError = (error: Error) => {
    console.error('PDF load error:', error)
    setPdfError(`Failed to load PDF: ${error.message}`)
  }

  const formatDocumentContent = (content: string) => {
    // Simple formatting: split into paragraphs
    const paragraphs = content.split('\n\n').filter(p => p.trim())
    return paragraphs.map((para, idx) => {
      // Check if it looks like a heading (short line, possibly all caps or title case)
      const isHeading = para.length < 100 && !para.includes('.')

      if (isHeading) {
        return (
          <h2 key={idx} className="text-2xl font-semibold mt-6 mb-3">
            {para}
          </h2>
        )
      }

      return (
        <p key={idx} className="leading-relaxed text-justify mb-4">
          {para}
        </p>
      )
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
          <p className="text-sm text-muted-foreground">
            The PDF file may be corrupted or the server may not be running.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            PDF URL: <code className="text-xs">{pdfUrl}</code>
          </p>
        </div>
      ) : (
        <>
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Loading PDF...</span>
              </div>
            }
            error={
              <div className="p-8 text-center">
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg">
                  <p className="font-semibold">Failed to load PDF</p>
                  <p className="text-sm mt-2">Please check if the backend server is running.</p>
                </div>
              </div>
            }
            options={{
              cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
              cMapPacked: true,
            }}
          >
            <Page
              pageNumber={pageNumber}
              scale={zoom / 100}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              onLoadSuccess={() => {
                // Enable text selection after page loads
                setTimeout(handleTextSelection, 100)
              }}
            />
          </Document>

          {numPages > 1 && (
            <div className="flex items-center gap-4 mt-4 p-2 bg-card rounded-lg border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
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
                onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
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
      {/* Toolbar */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Zoom:</span>
          <Button variant="outline" size="sm" onClick={() => setZoom(Math.max(50, zoom - 10))} className="gap-1">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
          <Button variant="outline" size="sm" onClick={() => setZoom(Math.min(200, zoom + 10))} className="gap-1">
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 hidden sm:flex bg-transparent">
            <Highlighter className="w-4 h-4" />
            Highlight
          </Button>
          <Button variant="outline" size="sm" className="gap-2 hidden sm:flex bg-transparent">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button variant="outline" size="sm" className="gap-2 bg-transparent">
            <Share2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Document Content */}
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
                Upload or select a document from the sidebar to get started with AI-powered learning.
              </p>
            </div>
          </div>
        ) : (
          <div onMouseUp={handleTextSelection}>
            {/* Document Header */}
            <div className="mb-6 pb-4 border-b max-w-4xl mx-auto">
              <h1 className="text-3xl font-bold">{documentName}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {documentType === 'application/pdf' ? 'PDF Document' : 'Text Document'}
              </p>
            </div>

            {/* PDF Viewer or Text Content */}
            {documentType === 'application/pdf' ? (
              renderPdfViewer()
            ) : (
              <div
                className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8 text-foreground"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
              >
                <div className="space-y-4">
                  {formatDocumentContent(documentContent)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection Highlight */}
      {selectedText && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-accent text-accent-foreground p-3 rounded-lg shadow-lg text-sm">
          <p className="font-semibold mb-1">Selected Text:</p>
          <p className="line-clamp-2 italic">"{selectedText}"</p>
          <p className="text-xs mt-2 opacity-75">Ask AI about this selection</p>
        </div>
      )}
    </div>
  )
}
