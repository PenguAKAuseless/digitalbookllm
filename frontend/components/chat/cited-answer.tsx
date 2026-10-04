"use client"

import { Fragment, ReactNode } from "react"
import * as Tooltip from "@radix-ui/react-tooltip"
import { FileText } from "lucide-react"
import { Citation } from "@/lib/api/rag"
import { useI18n } from "@/lib/i18n"

/** [1], [1, 3] or [1][3]: the passage markers the assistant is told to write. */
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g

/**
 * An answer with its [n] markers turned into links (UC13): hovering or focusing
 * a marker shows where the passage comes from, clicking it opens that page.
 * Markers that point past the retrieved passages stay plain text.
 */
export function CitedAnswer({
    text,
    citations,
    onCitationClick,
}: {
    text: string
    citations: Citation[]
    onCitationClick: (citation: Citation) => void
}) {
    const parts: ReactNode[] = []
    let last = 0
    for (const match of text.matchAll(MARKER)) {
        const start = match.index ?? 0
        if (start > last) parts.push(text.slice(last, start))
        const numbers = match[1].split(",").map((n) => Number(n.trim()))
        const valid = numbers.every((n) => citations[n - 1])
        parts.push(
            valid ? (
                <Fragment key={start}>
                    {numbers.map((n) => (
                        <CitationMarker key={n} index={n} citation={citations[n - 1]} onClick={() => onCitationClick(citations[n - 1])} />
                    ))}
                </Fragment>
            ) : (
                match[0]
            )
        )
        last = start + match[0].length
    }
    if (last < text.length) parts.push(text.slice(last))

    return (
        <Tooltip.Provider delayDuration={150}>
            <p className="whitespace-pre-wrap">{parts}</p>
        </Tooltip.Provider>
    )
}

function CitationMarker({ index, citation, onClick }: { index: number; citation: Citation; onClick: () => void }) {
    const { t } = useI18n()
    const source = `${citation.documentName ? `${citation.documentName} · ` : ""}${t("chat.citation")} ${citation.page ?? "—"}`
    return (
        <Tooltip.Root>
            <Tooltip.Trigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    aria-label={`[${index}] ${source}`}
                    className="mx-0.5 inline-flex items-center rounded px-1 align-super text-[0.7rem] font-semibold leading-none text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    {index}
                </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
                <Tooltip.Content
                    side="top"
                    align="start"
                    sideOffset={6}
                    collisionPadding={12}
                    className="z-50 max-w-xs rounded-md border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md"
                >
                    <p className="flex items-center gap-1.5 font-medium">
                        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                        <span>{source}</span>
                    </p>
                    <p className="mt-1.5 line-clamp-4 text-muted-foreground">{citation.text}</p>
                    <p className="mt-1.5 text-[0.65rem] text-primary">{t("chat.citationOpen")}</p>
                </Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    )
}
