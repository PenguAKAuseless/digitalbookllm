"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Highlight } from "@/lib/api/highlights"
import { HighlightOverlay } from "./highlight-overlay"
import { SelectionInfo } from "./selection-popover"
import { useI18n } from "@/lib/i18n"

// Must match SYNTHETIC_PAGE_CHARS in backend/src/ingestion/extractText.ts so
// the page numbers on chunks (and therefore on chat citations) line up with
// the pages shown here.
const SYNTHETIC_PAGE_CHARS = 3000

interface TextPageViewerProps {
    text: string
    highlights: Highlight[]
    initialPage?: number
    jumpToPage?: number | null
    onPageChange: (page: number) => void
    onSelectionChange: (selection: SelectionInfo | null) => void
}

/**
 * Reader for non-PDF uploads (DOCX, TXT, MD): shows the extracted text split
 * into the same synthetic pages the backend used for chunking. Pages carry
 * `data-page-number` so selection, highlights and citation jumps work the
 * same way they do in the PDF viewer.
 */
export function TextPageViewer({ text, highlights, initialPage = 1, jumpToPage, onPageChange, onSelectionChange }: TextPageViewerProps) {
    const { t } = useI18n()
    const containerRef = useRef<HTMLDivElement>(null)
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
    const [currentPage, setCurrentPage] = useState(initialPage)
    const [pageDims, setPageDims] = useState<Record<number, { width: number; height: number }>>({})

    const pages = useMemo(() => {
        const result: string[] = []
        for (let i = 0; i < Math.max(1, text.length); i += SYNTHETIC_PAGE_CHARS) result.push(text.slice(i, i + SYNTHETIC_PAGE_CHARS))
        return result
    }, [text])

    const highlightsByPage = useMemo(() => {
        const map = new Map<number, Highlight[]>()
        for (const h of highlights) map.set(h.location_meta.page, [...(map.get(h.location_meta.page) ?? []), h])
        return map
    }, [highlights])

    // Page sizes depend on text reflow, so re-measure whenever any page resizes.
    useEffect(() => {
        const observer = new ResizeObserver((entries) => {
            setPageDims((prev) => {
                const next = { ...prev }
                for (const entry of entries) {
                    // Border-box size, to match the getBoundingClientRect() the selection rects are normalized against.
                    const el = entry.target as HTMLElement
                    next[Number(el.dataset.pageNumber)] = { width: el.offsetWidth, height: el.offsetHeight }
                }
                return next
            })
        })
        Object.values(pageRefs.current).forEach((el) => el && observer.observe(el))
        return () => observer.disconnect()
    }, [pages])

    useEffect(() => {
        if (!containerRef.current) return
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
            { root: containerRef.current, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
        )
        Object.values(pageRefs.current).forEach((el) => el && observer.observe(el))
        return () => observer.disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pages])

    useEffect(() => {
        const page = jumpToPage ?? (initialPage > 1 ? initialPage : null)
        if (page) pageRefs.current[page]?.scrollIntoView({ block: "start" })
    }, [jumpToPage, initialPage])

    useEffect(() => {
        const handler = () => {
            // Typing a note focuses the popover's textarea, which collapses the
            // page selection — that is not the reader deselecting the text.
            if (document.activeElement?.closest("[data-selection-popover]")) return
            const sel = window.getSelection()
            const text = sel?.toString().trim()
            if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !text) {
                onSelectionChange(null)
                return
            }
            const range = sel.getRangeAt(0)
            const node = range.commonAncestorContainer
            const pageEl = (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement)?.closest("[data-page-number]") as HTMLElement | null
            if (!pageEl || !containerRef.current?.contains(pageEl)) return
            const pageRect = pageEl.getBoundingClientRect()
            const clientRects = Array.from(range.getClientRects())
            if (clientRects.length === 0) return
            const first = clientRects[0]
            onSelectionChange({
                text,
                page: Number(pageEl.dataset.pageNumber),
                rects: clientRects.map((r) => ({
                    x: (r.left - pageRect.left) / pageRect.width,
                    y: (r.top - pageRect.top) / pageRect.height,
                    width: r.width / pageRect.width,
                    height: r.height / pageRect.height,
                })),
                anchor: { top: first.top, left: first.left + first.width / 2 },
            })
        }
        document.addEventListener("selectionchange", handler)
        return () => document.removeEventListener("selectionchange", handler)
    }, [onSelectionChange])

    return (
        <div className="flex flex-1 w-full flex-col min-h-0">
            <div className="flex h-11 flex-shrink-0 items-center justify-center border-b border-border bg-card px-3 text-xs text-muted-foreground tabular-nums">
                {t("reader.page")} {currentPage} / {pages.length}
            </div>
            <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto bg-muted/50">
                <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
                    {pages.map((pageText, i) => {
                        const pageNumber = i + 1
                        return (
                            <div
                                key={pageNumber}
                                ref={(el) => { pageRefs.current[pageNumber] = el }}
                                data-page-number={pageNumber}
                                className="relative rounded-sm bg-card px-8 py-10 shadow-md ring-1 ring-black/5 sm:px-12"
                            >
                                <p className="whitespace-pre-wrap text-[15px] leading-7 text-card-foreground">{pageText}</p>
                                <span className="absolute bottom-3 right-4 text-[11px] text-muted-foreground tabular-nums">{pageNumber}</span>
                                {pageDims[pageNumber] && (
                                    <HighlightOverlay
                                        highlights={highlightsByPage.get(pageNumber) ?? []}
                                        pageWidth={pageDims[pageNumber].width}
                                        pageHeight={pageDims[pageNumber].height}
                                    />
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
