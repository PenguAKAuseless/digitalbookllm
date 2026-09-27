"use client"

import { useState } from "react"
import { Highlighter, StickyNote, Volume2, Sparkles } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

export interface SelectionInfo {
    text: string
    page: number
    /** Normalized (0-1) bounding rects relative to the page, so re-render is resolution-independent. */
    rects: Array<{ x: number; y: number; width: number; height: number }>
    /** Viewport position (px) used only for placing this popover. */
    anchor: { top: number; left: number }
}

const COLORS = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4"]

interface SelectionPopoverProps {
    selection: SelectionInfo
    onHighlight: (color: string) => void
    onNote: (note: string) => void
    onSpeak: () => void
    onAskAI: () => void
}

/** Contextual popover toolbar shown above a text selection (Luồng 1, UC11, UC12, UC14). */
export function SelectionPopover({ selection, onHighlight, onNote, onSpeak, onAskAI }: SelectionPopoverProps) {
    const { t } = useI18n()
    const [noteOpen, setNoteOpen] = useState(false)
    const [noteText, setNoteText] = useState("")

    return (
        <div
            data-selection-popover
            className="fixed z-50 -translate-x-1/2 -translate-y-full flex flex-col items-center gap-1"
            style={{ top: selection.anchor.top - 8, left: selection.anchor.left }}
            // Pressing a toolbar button would otherwise collapse the text selection
            // (and unmount this popover) before its click handler runs.
            onMouseDown={(e) => {
                if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault()
            }}
        >
            {noteOpen ? (
                <div className="bg-popover border border-border rounded-lg shadow-lg p-2 w-64">
                    <textarea
                        autoFocus
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t("popover.notePlaceholder")}
                        className="w-full h-20 text-sm resize-none rounded-md border border-input bg-background p-2 outline-none"
                    />
                    <div className="flex justify-end gap-1.5 mt-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>{t("popover.cancel")}</Button>
                        <Button size="sm" onClick={() => { onNote(noteText); setNoteOpen(false); setNoteText("") }}>{t("popover.save")}</Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg p-1">
                    <div className="flex items-center gap-0.5 pr-1 border-r border-border">
                        {COLORS.map((color) => (
                            <button
                                key={color}
                                onClick={() => onHighlight(color)}
                                title={t("popover.highlight")}
                                className="w-5 h-5 rounded-full border border-black/10"
                                style={{ backgroundColor: color }}
                            />
                        ))}
                    </div>
                    <PopoverButton icon={Highlighter} label={t("popover.highlight")} onClick={() => onHighlight(COLORS[0])} />
                    <PopoverButton icon={StickyNote} label={t("popover.note")} onClick={() => setNoteOpen(true)} />
                    <PopoverButton icon={Volume2} label={t("popover.speak")} onClick={onSpeak} />
                    <PopoverButton icon={Sparkles} label={t("popover.askAI")} onClick={onAskAI} />
                </div>
            )}
        </div>
    )
}

function PopoverButton({ icon: Icon, label, onClick }: { icon: typeof Highlighter; label: string; onClick: () => void }) {
    return (
        <button onClick={onClick} title={label} className="p-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
            <Icon className="w-4 h-4" />
        </button>
    )
}
