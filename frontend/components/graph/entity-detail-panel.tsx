"use client"

import { FileText, X } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { EntityDetail } from "@/lib/api/graph"

interface EntityDetailPanelProps {
    detail: EntityDetail
    onClose: () => void
    /** Opens the source book at the cited passage's page (UC13-style back-reference). */
    onOpenSource: (workspaceId: string, documentId: string, page: number | null) => void
    /** Moves the selection to a neighbouring entity. */
    onSelectEntity: (id: string) => void
}

/**
 * Detail panel shown when a graph node is selected (UC15 step 6): the
 * concept's description, its neighbours, and for each relation the verbatim
 * source passage it was extracted from, with a link to that page.
 */
export function EntityDetailPanel({ detail, onClose, onOpenSource, onSelectEntity }: EntityDetailPanelProps) {
    const { t } = useI18n()

    return (
        <div className="absolute top-0 right-0 h-full w-full sm:w-80 bg-card border-l border-border shadow-lg overflow-y-auto">
            <div className="p-4 flex items-start justify-between gap-2">
                <div>
                    <h3 className="font-semibold">{detail.entity.name}</h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{detail.entity.type}</p>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-muted rounded" aria-label={t("common.cancel")}>
                    <X className="w-4 h-4" />
                </button>
            </div>

            {detail.entity.description && <p className="px-4 pb-4 text-sm text-muted-foreground">{detail.entity.description}</p>}

            <div className="px-4 pb-4">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                    {t("graph.detail.relatedTo")} ({detail.neighbors.length})
                </h4>
                <div className="space-y-2">
                    {detail.neighbors.map((n, i) => {
                        const canOpen = Boolean(n.source_document_id && n.source_workspace_id)
                        return (
                            <div key={i} className="rounded-md border border-border p-2">
                                <button onClick={() => onSelectEntity(n.id)} className="text-left text-sm font-medium hover:underline">
                                    {n.name}
                                </button>
                                <p className="text-xs text-muted-foreground">{n.relation_type}</p>
                                {n.excerpt && (
                                    <blockquote className="mt-1 border-l-2 border-primary/40 pl-2 text-xs italic line-clamp-3">&ldquo;{n.excerpt}&rdquo;</blockquote>
                                )}
                                {n.source_document_title && (
                                    <button
                                        disabled={!canOpen}
                                        onClick={() => canOpen && onOpenSource(n.source_workspace_id!, n.source_document_id!, n.source_page)}
                                        className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground hover:bg-secondary/70 disabled:opacity-60"
                                        title={canOpen ? t("graph.detail.openSource") : undefined}
                                    >
                                        <FileText className="h-3 w-3 shrink-0" />
                                        <span className="truncate">{n.source_document_title}</span>
                                        {n.source_page !== null && (
                                            <span className="shrink-0">
                                                · {t("chat.citation")} {n.source_page}
                                            </span>
                                        )}
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
