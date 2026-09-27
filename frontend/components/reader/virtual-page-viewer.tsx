"use client"

import "./pdf-config"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Document, Page } from "react-pdf"
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import { Highlight } from "@/lib/api/highlights"
import { HighlightOverlay } from "./highlight-overlay"
import { SelectionInfo } from "./selection-popover"
import { useI18n } from "@/lib/i18n"

const OVERSCAN_PAGES = 2
const BASE_PAGE_HEIGHT_ESTIMATE = 1100 // px, used only before a page has actually rendered
const DEFAULT_PAGE_ASPECT = 1.414 // A4 portrait, until a real page has been measured
const PAGE_GUTTER_PX = 48
const MAX_FIT_WIDTH_PX = 1100 // don't blow pages up to absurd sizes on very wide screens
const TOOLBAR_BUTTON =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"

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
    // `scale` is relative to fit-to-width: 1 = the page exactly fills the reading pane.
    const [scale, setScale] = useState(1)
    const [fitWidth, setFitWidth] = useState<number | null>(null)
    // Height/width per rendered page: zoom-independent, so slot heights stay right after zooming.
    const [pageAspects, setPageAspects] = useState<Record<number, number>>({})
    const [pageDims, setPageDims] = useState<Record<number, { width: number; height: number }>>({})
    const [loadError, setLoadError] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)
    const [pageInput, setPageInput] = useState(String(initialPage))

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
        const visibility = new Map<number, number>()
        const observer = new IntersectionObserver(
            (entries) => {
                // Entries only cover pages whose visibility just changed, so keep
                // every page's latest visible height and pick the most visible overall.
                for (const e of entries) visibility.set(Number((e.target as HTMLElement).dataset.pageNumber), e.isIntersecting ? e.intersectionRect.height : 0)
                let best = 0
                let bestRatio = 0
                visibility.forEach((ratio, page) => {
                    if (ratio > bestRatio || (ratio === bestRatio && ratio > 0 && page < best)) {
                        best = page
                        bestRatio = ratio
                    }
                })
                if (best > 0) {
                    setCurrentPage(best)
                    onPageChange(best)
                }
            },
            // Several thresholds so a page taller than the viewport (high zoom) still registers as current.
            { root: containerRef.current, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
        )
        Object.values(pageRefs.current).forEach((el) => el && observer.observe(el))
        return () => observer.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [numPages])

    // Track the pane width so pages fit it (and refit when the split pane is resized).
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => {
            const width = Math.floor(entry.contentRect.width - PAGE_GUTTER_PX)
            setFitWidth((prev) => (prev !== null && Math.abs(prev - width) < 8 ? prev : Math.max(240, Math.min(width, MAX_FIT_WIDTH_PX))))
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        setPageInput(String(currentPage))
    }, [currentPage])

    const scrollToPage = useCallback((page: number) => {
        pageRefs.current[page]?.scrollIntoView({ block: "start" })
    }, [])

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

    // Unrendered pages borrow a rendered page's aspect ratio (most PDFs have
    // uniform pages) so scroll offsets — and therefore page jumps — stay accurate.
    const renderedWidth = (fitWidth ?? 0) * scale
    const fallbackAspect = Object.values(pageAspects)[0] ?? DEFAULT_PAGE_ASPECT
    const slotHeight = (page: number) => (renderedWidth ? renderedWidth * (pageAspects[page] ?? fallbackAspect) : BASE_PAGE_HEIGHT_ESTIMATE)

    const isInRenderRange = useCallback(
        (page: number) => Math.abs(page - currentPage) <= OVERSCAN_PAGES,
        [currentPage]
    )

    const commitPageInput = () => {
        const page = Number.parseInt(pageInput, 10)
        if (Number.isFinite(page) && page >= 1 && page <= numPages) scrollToPage(page)
        else setPageInput(String(currentPage))
    }

    return (
        <div className="flex flex-1 w-full flex-col min-h-0">
            <div className="flex h-11 flex-shrink-0 items-center justify-center gap-1 whitespace-nowrap border-b border-border bg-card px-2 text-sm sm:px-3">
                <button className={TOOLBAR_BUTTON} disabled={currentPage <= 1} onClick={() => scrollToPage(Math.max(1, currentPage - 1))} aria-label="Previous page">
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="hidden sm:inline">{t("reader.page")}</span>
                    <input
                        value={pageInput}
                        onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                        onBlur={commitPageInput}
                        onKeyDown={(e) => e.key === "Enter" && commitPageInput()}
                        disabled={numPages === 0}
                        inputMode="numeric"
                        aria-label={t("reader.page")}
                        className="h-7 w-11 rounded-md border border-input bg-background text-center text-xs tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <span className="tabular-nums">/ {numPages || "–"}</span>
                </div>
                <button className={TOOLBAR_BUTTON} disabled={currentPage >= numPages} onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))} aria-label="Next page">
                    <ChevronRight className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-border mx-1 sm:mx-2" />
                <button className={TOOLBAR_BUTTON} onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))} title={t("reader.zoomOut")}>
                    <ZoomOut className="w-4 h-4" />
                </button>
                <button
                    className="h-7 min-w-[3.25rem] rounded-md px-1.5 text-xs tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setScale(1)}
                    title={t("reader.fitWidth")}
                >
                    {Math.round(scale * 100)}%
                </button>
                <button className={TOOLBAR_BUTTON} onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))} title={t("reader.zoomIn")}>
                    <ZoomIn className="w-4 h-4" />
                </button>
            </div>

            <div ref={containerRef} className="flex-1 min-h-0 overflow-auto bg-muted/50">
                {loadError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                            <AlertTriangle className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-foreground">{t("reader.loadFailed")}</p>
                            <p className="mt-1 max-w-sm text-xs text-muted-foreground">{loadError}</p>
                        </div>
                        <button
                            onClick={() => {
                                setLoadError(null)
                                setReloadKey((k) => k + 1)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                            <RotateCcw className="w-3.5 h-3.5" /> {t("common.retry")}
                        </button>
                    </div>
                ) : (
                <Document
                    key={reloadKey}
                    file={fileUrl}
                    onLoadError={(err) => {
                        console.error("[reader] PDF load failed:", err)
                        setLoadError(err.message)
                    }}
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
                    loading={
                        <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
                        </div>
                    }
                    className="flex min-w-fit flex-col items-center gap-4 px-4 py-6"
                >
                    {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
                        <div
                            key={pageNumber}
                            ref={(el) => { pageRefs.current[pageNumber] = el }}
                            data-page-number={pageNumber}
                            className="relative bg-white shadow-md ring-1 ring-black/5"
                            style={{ minHeight: slotHeight(pageNumber), width: renderedWidth || undefined }}
                        >
                            {isInRenderRange(pageNumber) && fitWidth !== null && (
                                <>
                                    <Page
                                        pageNumber={pageNumber}
                                        width={fitWidth ?? undefined}
                                        scale={scale}
                                        renderAnnotationLayer={false}
                                        onRenderSuccess={(page) => {
                                            setPageAspects((prev) => (prev[pageNumber] ? prev : { ...prev, [pageNumber]: page.height / page.width }))
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
                )}
            </div>
        </div>
    )
}
