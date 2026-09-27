"use client"

import { FileText } from "lucide-react"
import { Citation } from "@/lib/api/rag"
import { useI18n } from "@/lib/i18n"

/** Citation card (UC13): clicking it scrolls the reader pane to the source page. */
export function CitationChip({ citation, onClick }: { citation: Citation; onClick: () => void }) {
    const { t } = useI18n()
    return (
        <button
            onClick={onClick}
            className="inline-flex items-center gap-1 text-xs bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 hover:bg-secondary/70 transition-colors"
            title={citation.text}
        >
            <FileText className="w-3 h-3" />
            {citation.documentName ? `${citation.documentName} · ` : ""}
            {t("chat.citation")} {citation.page ?? "—"}
        </button>
    )
}
