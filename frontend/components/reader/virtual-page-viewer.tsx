"use client"

import "./pdf-config"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Document, Page } from "react-pdf"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react"
import { Highlight } from "@/lib/api/highlights"
import { HighlightOverlay } from "./highlight-overlay"
import { SelectionInfo } from "./selection-popover"
import { useI18n } from "@/lib/i18n"

const OVERSCAN_PAGES = 2
const BASE_PAGE_HEIGHT_ESTIMATE = 1100 // px, used only before a page has actually rendered

export interface OutlineEntry {
    title: string
    page: number
}

interface VirtualPageViewerProps {
    fileUrl: string
    highlights: Highlight[]
    initialPage?: number
    jumpToPage?: number | null
    onDocumentLoad: (info: { numPages: number; outline: OutlineEntry[] }) => void
    onPageChange: (page: number) => void
    onSelectionChange: (selection: SelectionInfo | null) => void
}

/**
 * Windowed PDF page renderer (FR08): only pages within [current - overscan,
 * current + overscan] are actually rendered by pdf.js; every other slot keeps
 * its measured (or estimated) height so scrolling stays smooth on documents
 * with thousands of pages.
 */
export function VirtualPageViewer({
    fileUrl, highlights, initialPage = 1, jumpToPage, onDocumentLoad, onPageChange, onSelectionChange,
}: VirtualPageViewerProps) {
    const { t } = useI18n()
    const [numPages, setNumPages] = useState(0)
    const [currentPage, setCurrentPage] = useState(initialPage)
    const [scale, setScale] = useState(1.1)
    const [pageHeights, setPageHeights] = useState<Record<number, number>>({})
    const [pageDims, setPageDims] = useState<Record<number, { width: number; height: number }>>({})

    const containerRef = useRef<HTMLDivElement>(null)
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})

    const highlightsByPage = useMemo(() => {
        const map = new Map<number, Highlight[]>()
        for (const h of highlights) {
            const page = h.location_meta.page
            map.set(page, [...(map.get(page) ?? []), h])
        }
        return map
    }, [highlights])

    // Track which page is centered in the viewport, to report reading progress and drive virtualization.
    useEffect(() => {
        if (!containerRef.current || numPages === 0) return
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)
                if (visible.length > 0) {
                    const page = Number((visible[0].target as HTMLElement).dataset.pageNumber)
                    setCurrentPage(page)
                    onPageChange(page)
                }
            },
            { root: containerRef.current, threshold: [0.5] }
        )
        Object.values(pageRefs.current).forEach((el) => el && observer.observe(el))
        return () => observer.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numPages])

    useEffect(() => {
        if (jumpToPage) {
            pageRefs.current[jumpToPage]?.scrollIntoView({ block: "start" })
        }
    }, [jumpToPage])

    useEffect(() => {
        const handler = () => {
            const sel = window.getSelection()
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
                onSelectionChange(null)
                return
            }
            const range = sel.getRangeAt(0)
            const text = sel.toString().trim()
            if (!text) {
                onSelectionChange(null)
                return
            }

            const pageEl = (range.commonAncestorContainer as HTMLElement)?.closest?.("[data-page-number]") as HTMLElement | null
            if (!pageEl) return
            const pageNumber = Number(pageEl.dataset.pageNumber)
            const pageRect = pageEl.getBoundingClientRect()
            const clientRects = Array.from(range.getClientRects())
            if (clientRects.length === 0) return

            const rects = clientRects.map((r) => ({
                x: (r.left - pageRect.left) / pageRect.width,
                y: (r.top - pageRect.top) / pageRect.height,
                width: r.width / pageRect.width,
                height: r.height / pageRect.height,
            }))

            const first = clientRects[0]
            onSelectionChange({
                text,
                page: pageNumber,
                rects,
                anchor: { top: first.top, left: first.left + first.width / 2 },
            })
        }

        document.addEventListener("selectionchange", handler)
        return () => document.removeEventListener("selectionchange", handler)
    }, [onSelectionChange])

    const isInRenderRange = useCallback(
        (page: number) => Math.abs(page - currentPage) <= OVERSCAN_PAGES,
        [currentPage]
    )

    return (
        <div className="relative flex-1 flex flex-col min-h-0">
            <div ref={containerRef} className="flex-1 overflow-y-auto bg-muted/40">
                <Document
                    file={fileUrl}
                    onLoadSuccess={async (pdf) => {
                        setNumPages(pdf.numPages)
                        const rawOutline = await pdf.getOutline().catch(() => null)
                        const outline: OutlineEntry[] = []
                        if (rawOutline) {
                            for (const item of rawOutline) {
                                try {
                                    const dest = await pdf.getDestination(item.dest as any)
                                    const pageIndex = dest ? await pdf.getPageIndex(dest[0]) : 0
                                    outline.push({ title: item.title, page: pageIndex + 1 })
                                } catch {
                                    // Skip entries whose destination cannot be resolved.
                                }
                            }
                        }
                        onDocumentLoad({ numPages: pdf.numPages, outline })
                    }}
                    loading={<div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>}
                    className="flex flex-col items-center gap-3 py-4"
                >
                    {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
                        <div
                            key={pageNumber}
                            ref={(el) => { pageRefs.current[pageNumber] = el }}
                            data-page-number={pageNumber}
                            className="relative bg-white shadow-sm"
                            style={{ minHeight: pageHeights[pageNumber] ?? BASE_PAGE_HEIGHT_ESTIMATE * scale }}
                        >
                            {isInRenderRange(pageNumber) && (
                                <>
                                    <Page
                                        pageNumber={pageNumber}
                                        scale={scale}
                                        renderAnnotationLayer={false}
                                        onRenderSuccess={(page) => {
                                            setPageHeights((prev) => ({ ...prev, [pageNumber]: page.height }))
                                            setPageDims((prev) => ({ ...prev, [pageNumber]: { width: page.width, height: page.height } }))
                                        }}
                                    />
                                    {pageDims[pageNumber] && (
                                        <HighlightOverlay
                                            highlights={highlightsByPage.get(pageNumber) ?? []}
                                            pageWidth={pageDims[pageNumber].width}
                                            pageHeight={pageDims[pageNumber].height}
                                        />
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </Document>
            </div>

            <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-card/95 border border-border rounded-lg shadow-sm px-2 py-1 text-sm">
                <button className="p-1 hover:bg-muted rounded" onClick={() => pageRefs.current[Math.max(1, currentPage - 1)]?.scrollIntoView({ block: "start" })}>
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="tabular-nums px-1 text-xs text-muted-foreground">
                    {t("reader.page")} {currentPage} {t("reader.of")} {numPages}
                </span>
                <button className="p-1 hover:bg-muted rounded" onClick={() => pageRefs.current[Math.min(numPages, currentPage + 1)]?.scrollIntoView({ block: "start" })}>
                    <ChevronRight className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button className="p-1 hover:bg-muted rounded" onClick={() => setScale((s) => Math.max(0.5, s - 0.1))} title={t("reader.zoomOut")}>
                    <ZoomOut className="w-4 h-4" />
                </button>
                <button className="p-1 hover:bg-muted rounded" onClick={() => setScale((s) => Math.min(2.5, s + 0.1))} title={t("reader.zoomIn")}>
                    <ZoomIn className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
