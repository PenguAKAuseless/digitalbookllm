"use client"

import { useEffect, useRef, useState } from "react"
import { Send, X, Sparkles } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { CitationChip } from "./citation-chip"
import { streamQuery, ragAPI, Citation, ChatMessage } from "@/lib/api/rag"
import { speak } from "@/lib/tts"

interface ChatPanelProps {
    workspaceId: string
    documentId: string
    selectedText: string
    onClearSelection: () => void
    onCitationClick: (citation: Citation) => void
    /** Bumped by the parent (e.g. after "Ask AI") to force-focus and send the current selection. */
    askSignal: number
}

interface DisplayMessage {
    id: string
    role: "user" | "assistant"
    content: string
    citations?: Citation[]
}

const SUGGESTIONS: Array<{ key: string; text: string }> = [
    { key: "chat.suggestion.summarize", text: "Summarize this passage" },
    { key: "chat.suggestion.explain", text: "Explain the difficult concept" },
    { key: "chat.suggestion.translate", text: "Translate to Vietnamese" },
]

/** AI assistant pane (UC13, UC14): streams answers over SSE with citation cards. */
export function ChatPanel({ workspaceId, documentId, selectedText, onClearSelection, onCitationClick, askSignal }: ChatPanelProps) {
    const { t, lang } = useI18n()
    const [messages, setMessages] = useState<DisplayMessage[]>([])
    const [sessionId, setSessionId] = useState<string | undefined>(undefined)
    const [input, setInput] = useState("")
    const [streaming, setStreaming] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        setMessages([])
        setSessionId(undefined)
    }, [documentId])

    useEffect(() => {
        if (selectedText) inputRef.current?.focus()
    }, [selectedText, askSignal])

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
    }, [messages])

    const send = async (query: string) => {
        if (!query.trim() || streaming) return
        setError(null)
        setInput("")

        const userMessage: DisplayMessage = { id: `local-${Date.now()}`, role: "user", content: query }
        const assistantId = `local-${Date.now()}-a`
        setMessages((prev) => [...prev, userMessage, { id: assistantId, role: "assistant", content: "" }])
        setStreaming(true)

        const controller = new AbortController()
        abortRef.current = controller

        await streamQuery(
            { query, workspaceId, documentId, selectedText: selectedText || undefined, sessionId },
            {
                onDelta: (delta) => {
                    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)))
                },
                onCitations: (citations) => {
                    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, citations } : m)))
                },
                onDone: (result) => {
                    if (result.sessionId) setSessionId(result.sessionId)
                    const cited = new Set(result.citedIndices ?? [])
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantId && m.citations
                                ? { ...m, citations: m.citations.map((c, i) => ({ ...c, cited: cited.has(i + 1) })) }
                                : m
                        )
                    )
                    setStreaming(false)
                    onClearSelection()
                },
                onError: (message) => {
                    setError(message)
                    setStreaming(false)
                },
            },
            controller.signal
        )
    }

    return (
        <div className="flex flex-col h-full bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold">{t("chat.title")}</h2>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.length === 0 && !selectedText && (
                    <p className="text-xs text-muted-foreground text-center py-8">{t("chat.empty")}</p>
                )}
                {messages.map((m) => (
                    <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                        <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                            <p className="whitespace-pre-wrap">{m.content || (streaming ? t("chat.thinking") : "")}</p>
                            {m.citations && m.citations.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {m.citations.map((c, i) => (
                                        <CitationChip key={c.chunkId} index={i + 1} citation={c} onClick={() => onCitationClick(c)} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {error && <p className="text-xs text-destructive text-center">{error}</p>}
            </div>

            {selectedText && (
                <div className="mx-3 mb-2 rounded-md border border-border bg-muted/60 p-2 text-xs relative">
                    <button onClick={onClearSelection} className="absolute top-1 right-1 p-0.5 hover:bg-muted rounded">
                        <X className="w-3 h-3" />
                    </button>
                    <blockquote className="pr-4 line-clamp-3 italic text-muted-foreground">&ldquo;{selectedText}&rdquo;</blockquote>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s.key}
                                onClick={() => send(t(s.key))}
                                className="text-[11px] bg-background border border-border rounded-full px-2 py-0.5 hover:bg-accent"
                            >
                                {t(s.key)}
                            </button>
                        ))}
                        <button
                            onClick={() => speak(selectedText, lang)}
                            className="text-[11px] bg-background border border-border rounded-full px-2 py-0.5 hover:bg-accent"
                        >
                            {t("popover.speak")}
                        </button>
                    </div>
                </div>
            )}

            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    send(input)
                }}
                className="p-3 border-t border-border flex items-end gap-2"
            >
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            send(input)
                        }
                    }}
                    placeholder={t("chat.placeholder")}
                    rows={1}
                    className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none max-h-24"
                />
                <Button type="submit" size="icon" disabled={streaming || !input.trim()}>
                    <Send className="w-4 h-4" />
                </Button>
            </form>
        </div>
    )
}
