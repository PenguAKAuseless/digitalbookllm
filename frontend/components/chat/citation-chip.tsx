"use client"

import { FileText } from "lucide-react"
import { Citation } from "@/lib/api/rag"
import { useI18n } from "@/lib/i18n"

/**
 * Citation card (UC13): clicking it scrolls the reader pane to the source page.
 * `index` matches the [n] markers in the answer; passages the finished answer
 * does not cite stay available but are dimmed, so cited sources stand out.
 */
export function CitationChip({ citation, index, onClick }: { citation: Citation; index: number; onClick: () => void }) {
    const { t } = useI18n()
    const uncited = citation.cited === false
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 transition-colors ${
                uncited
                    ? "border border-dashed border-border text-muted-foreground hover:bg-muted"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
            }`}
            title={uncited ? `${t("chat.citationUncited")}

${citation.text}` : citation.text}
        >
            <FileText className="w-3 h-3" />
            <span className="font-medium">[{index}]</span>
            {citation.documentName ? `${citation.documentName} · ` : ""}
            {t("chat.citation")} {citation.page ?? "—"}
        </button>
    )
}
