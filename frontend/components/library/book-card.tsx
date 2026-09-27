"use client"

import { useEffect, useState } from "react"
import { BookOpen, FileWarning, Loader2, Trash2 } from "lucide-react"
import { Document } from "@/lib/api/documents"
import { documentAPI } from "@/lib/api/documents"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface BookCardProps {
    document: Document
    onOpen: () => void
    onDelete: () => void
}

/**
 * Library grid card (UC06). Shows a cover thumbnail once ingestion finishes,
 * a processing indicator while it doesn't (UC07 progress feedback), and the
 * reading-progress ratio derived from last_read_page/page_count.
 */
export function BookCard({ document, onOpen, onDelete }: BookCardProps) {
    const { t } = useI18n()
    const [coverUrl, setCoverUrl] = useState<string | null>(null)

    useEffect(() => {
        if (document.status !== "READY") return
        documentAPI.getCoverUrl(document.id).then((res) => res && setCoverUrl(res.url))
    }, [document.id, document.status])

    const progress = document.page_count ? Math.min(100, Math.round((document.last_read_page / document.page_count) * 100)) : 0
    const isReady = document.status === "READY"
    const isFailed = document.status === "FAILED"

    return (
        <div className="group relative rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
            <button
                onClick={() => isReady && onOpen()}
                disabled={!isReady}
                aria-label={t("library.openBook")}
                className={cn("block w-full aspect-[3/4] bg-muted relative", isReady && "cursor-pointer")}
            >
                {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl} alt={document.title} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        {isFailed ? <FileWarning className="w-8 h-8" /> : isReady ? <BookOpen className="w-8 h-8" /> : <Loader2 className="w-8 h-8 animate-spin" />}
                        <span className="text-xs px-2 text-center">{t(`library.status.${document.status}`)}</span>
                    </div>
                )}

                {isReady && progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </button>

            <div className="p-3">
                <p className="text-sm font-medium truncate" title={document.title}>{document.title}</p>
                <p className="text-xs text-muted-foreground truncate">{document.author || t(`library.status.${document.status}`)}</p>
            </div>

            <button
                onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                }}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                title={t("library.delete")}
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
        </div>
    )
}
