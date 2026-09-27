"use client"

import { useState } from "react"
import { List, Highlighter, Bookmark } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { Highlight } from "@/lib/api/highlights"
import { OutlineEntry } from "./virtual-page-viewer"
import { cn } from "@/lib/utils"

interface ReaderSidebarProps {
    outline: OutlineEntry[]
    highlights: Highlight[]
    onJumpToPage: (page: number) => void
    onDeleteHighlight: (id: string) => void
}

type Tab = "toc" | "highlights"

/** Sidebar for the reading screen (6.1): table of contents and highlights/bookmarks (UC08, UC10, UC11). */
export function ReaderSidebar({ outline, highlights, onJumpToPage, onDeleteHighlight }: ReaderSidebarProps) {
    const { t } = useI18n()
    const [tab, setTab] = useState<Tab>(outline.length > 0 ? "toc" : "highlights")

    return (
        <div className="flex flex-col h-full">
            <div className="flex border-b border-border">
                <TabButton icon={List} label={t("reader.toc")} active={tab === "toc"} onClick={() => setTab("toc")} />
                <TabButton icon={Highlighter} label={t("reader.highlights")} active={tab === "highlights"} onClick={() => setTab("highlights")} />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {tab === "toc" &&
                    (outline.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">—</p>
                    ) : (
                        outline.map((entry, i) => (
                            <button
                                key={i}
                                onClick={() => onJumpToPage(entry.page)}
                                className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-muted truncate"
                                title={entry.title}
                            >
                                {entry.title}
                            </button>
                        ))
                    ))}

                {tab === "highlights" &&
                    (highlights.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">—</p>
                    ) : (
                        highlights.map((h) => (
                            <div key={h.id} className="group px-3 py-2 rounded-md hover:bg-muted">
                                <button onClick={() => onJumpToPage(h.location_meta.page)} className="w-full text-left flex items-start gap-2">
                                    {h.type === "BOOKMARK" ? (
                                        <Bookmark className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                                    ) : (
                                        <span className="w-3 h-3 mt-1 rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} />
                                    )}
                                    <span className="text-xs line-clamp-2">{h.content || h.note || `${t("reader.page")} ${h.location_meta.page}`}</span>
                                </button>
                                <div className="flex justify-end mt-1 opacity-0 group-hover:opacity-100">
                                    <button
                                        onClick={() => onDeleteHighlight(h.id)}
                                        className="text-xs text-muted-foreground hover:text-destructive"
                                    >
                                        {t("common.delete")}
                                    </button>
                                </div>
                            </div>
                        ))
                    ))}
            </div>
        </div>
    )
}

function TabButton({ icon: Icon, label, active, onClick }: { icon: typeof List; label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
        >
            <Icon className="w-3.5 h-3.5" /> {label}
        </button>
    )
}
