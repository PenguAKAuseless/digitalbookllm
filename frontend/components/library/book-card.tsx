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
    onDelete: () => Promise<void> | void
}

/**
 * Library grid card (UC06). Shows a cover thumbnail once ingestion finishes,
 * a processing indicator while it doesn't (UC07 progress feedback), and the
 * reading-progress ratio derived from last_read_page/page_count.
 */
export function BookCard({ document, onOpen, onDelete }: BookCardProps) {
    const { t } = useI18n()
    const [coverUrl, setCoverUrl] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    useEffect(() => {
        if (document.status !== "READY") return
        documentAPI.getCoverUrl(document.id).then((res) => res && setCoverUrl(res.url))
    }, [document.id, document.status])

    const progress = document.page_count ? Math.min(100, Math.round((document.last_read_page / document.page_count) * 100)) : 0
    const isReady = document.status === "READY"
    const isFailed = document.status === "FAILED"
    const isPdf = document.file_type === "application/pdf" || document.title.toLowerCase().endsWith(".pdf")
    // PDFs render straight from storage, so they can be read while ingestion
    // (chunking/embedding for the AI assistant) is still running.
    const canOpen = isReady || (isPdf && !isFailed)
    const extension = document.title.split(".").pop()?.toUpperCase()

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!window.confirm(t("library.deleteConfirm").replace("{title}", document.title))) return
        setDeleting(true)
        try {
            await onDelete()
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div
            className={cn(
                "group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden transition-all",
                canOpen && "hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/30",
                deleting && "opacity-50 pointer-events-none"
            )}
        >
            <button
                onClick={() => canOpen && onOpen()}
                disabled={!canOpen}
                aria-label={t("library.openBook")}
                className={cn("block w-full aspect-[3/4] bg-muted relative overflow-hidden", canOpen && "cursor-pointer")}
            >
                {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl} alt={document.title} className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.03]" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary to-muted text-muted-foreground">
                        {isFailed ? (
                            <FileWarning className="w-8 h-8 text-destructive" />
                        ) : isReady ? (
                            <BookOpen className="w-8 h-8 text-primary/70" />
                        ) : (
                            <Loader2 className="w-8 h-8 animate-spin text-primary/70" />
                        )}
                        <span className="text-xs px-2 text-center">{t(`library.status.${document.status}`)}</span>
                    </div>
                )}

                {extension && (
                    <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground shadow-sm">
                        {extension}
                    </span>
                )}

                {!isReady && !isFailed && canOpen && (
                    <span className="absolute bottom-2 left-2 right-2 rounded-md bg-background/90 px-2 py-1 text-[10px] font-medium text-primary shadow-sm">
                        {t("library.readWhileProcessing")}
                    </span>
                )}

                {isReady && progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/15">
                        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </button>

            <div className="flex flex-1 flex-col gap-0.5 p-3">
                <p className="text-sm font-medium leading-snug line-clamp-2" title={document.title}>{document.title}</p>
                <p className={cn("mt-auto pt-1 text-xs truncate", isFailed ? "text-destructive" : "text-muted-foreground")}>
                    {isReady && document.page_count
                        ? `${document.page_count} ${t("reader.page").toLowerCase()}${progress > 0 ? ` · ${progress}%` : ""}`
                        : document.author || t(`library.status.${document.status}`)}
                </p>
            </div>

            <button
                onClick={handleDelete}
                className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                title={t("library.delete")}
                aria-label={t("library.delete")}
            >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
        </div>
    )
}
