"use client"

import { useState } from "react"
import { List, Highlighter, Bookmark, Trash2, BookMarked } from "lucide-react"
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
        <div className="flex flex-col h-full w-full min-h-0">
            <div className="flex h-11 flex-shrink-0 border-b border-border">
                <TabButton icon={List} label={t("reader.toc")} active={tab === "toc"} onClick={() => setTab("toc")} />
                <TabButton icon={Highlighter} label={t("reader.highlights")} active={tab === "highlights"} onClick={() => setTab("highlights")} />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {tab === "toc" &&
                    (outline.length === 0 ? (
                        <EmptyState icon={List} text={t("reader.tocEmpty")} />
                    ) : (
                        outline.map((entry, i) => (
                            <button
                                key={i}
                                onClick={() => onJumpToPage(entry.page)}
                                className="w-full text-left text-sm px-3 py-2 rounded-md text-foreground/90 hover:bg-muted hover:text-foreground truncate transition-colors"
                                title={entry.title}
                            >
                                {entry.title}
                            </button>
                        ))
                    ))}

                {tab === "highlights" &&
                    (highlights.length === 0 ? (
                        <EmptyState icon={BookMarked} text={t("reader.highlightsEmpty")} />
                    ) : (
                        <ul className="space-y-1">
                            {highlights.map((h) => (
                                <li key={h.id} className="group relative flex items-start gap-1 rounded-md hover:bg-muted transition-colors">
                                    <button onClick={() => onJumpToPage(h.location_meta.page)} className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left">
                                        {h.type === "BOOKMARK" ? (
                                            <Bookmark className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                                        ) : (
                                            <span className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} />
                                        )}
                                        <span className="min-w-0">
                                            <span className="block text-xs text-foreground line-clamp-3">{h.content || h.note || `${t("reader.page")} ${h.location_meta.page}`}</span>
                                            {h.note && h.content && <span className="mt-1 block text-[11px] italic text-muted-foreground line-clamp-2">{h.note}</span>}
                                            <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground">{t("reader.page")} {h.location_meta.page}</span>
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => onDeleteHighlight(h.id)}
                                        className="mr-1 mt-1.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                        title={t("common.delete")}
                                        aria-label={t("common.delete")}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
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
                "flex-1 flex items-center justify-center gap-1.5 px-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
        >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" /> <span className="truncate">{label}</span>
        </button>
    )
}

function EmptyState({ icon: Icon, text }: { icon: typeof List; text: string }) {
    return (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
            <Icon className="w-6 h-6 opacity-50" />
            <p className="text-xs leading-relaxed">{text}</p>
        </div>
    )
}
