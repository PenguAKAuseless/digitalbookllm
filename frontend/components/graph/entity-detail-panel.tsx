"use client"

import { X } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { EntityDetail } from "@/lib/api/graph"

/** Detail panel shown when a graph node is selected (6.2.C): description + source excerpts. */
export function EntityDetailPanel({ detail, onClose }: { detail: EntityDetail; onClose: () => void }) {
    const { t } = useI18n()

    return (
        <div className="absolute top-0 right-0 h-full w-80 bg-card border-l border-border shadow-lg overflow-y-auto">
            <div className="p-4 flex items-start justify-between gap-2">
                <div>
                    <h3 className="font-semibold">{detail.entity.name}</h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{detail.entity.type}</p>
                </div>
                <button onClick={onClose} className="p-1 hover:bg-muted rounded">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {detail.entity.description && (
                <p className="px-4 pb-4 text-sm text-muted-foreground">{detail.entity.description}</p>
            )}

            <div className="px-4 pb-4">
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">{t("graph.detail.relatedTo")}</h4>
                <div className="space-y-2">
                    {detail.neighbors.map((n, i) => (
                        <div key={i} className="rounded-md border border-border p-2">
                            <p className="text-sm font-medium">{n.name}</p>
                            <p className="text-xs text-muted-foreground">{n.relation_type}</p>
                            {n.excerpt && <p className="text-xs mt-1 line-clamp-2 italic">&ldquo;{n.excerpt}&rdquo;</p>}
                            {n.source_document_title && <p className="text-[11px] text-muted-foreground mt-1">{n.source_document_title}</p>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
