"use client"

import { useState, useRef, useEffect } from "react"
import {
    Send, MessageCircle, Copy, Loader2, Trash2,
    History, Plus, FileText, Globe, Volume2, Square, X,
    Brain, FileBarChart, RotateCcw
} from "lucide-react"
import { ragAPI, ChatSession } from "@/lib/api/rag"
import { agenticRAG } from "@/lib/api/advanced"

interface Message {
    id: string
    role: "user" | "assistant"
    content: string
    timestamp: Date
    selectedText?: string
    source?: "document" | "workspace" | "none"
    sourceDocumentName?: string
    origin?: "chat" | "summary"
}

interface ChatPanelProps {
    workspaceId?: string
    documentId?: string
    documentName?: string
    selectedText?: string
    onClearSelection?: () => void
    onOpenQuiz?: () => void
}

export function ChatPanel({ workspaceId, documentId, documentName: _documentName, selectedText, onClearSelection, onOpenQuiz }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isSummarizing, setIsSummarizing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sessions, setSessions] = useState<ChatSession[]>([])
    const [activeSessionId, setActiveSessionId] = useState<string | undefined>()
    const [showSessions, setShowSessions] = useState(false)
    const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null)
    const [speechSupported, setSpeechSupported] = useState(false)
    const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    useEffect(() => {
        const ok = typeof window !== "undefined" && "speechSynthesis" in window
        setSpeechSupported(ok)
        return () => { if (ok) window.speechSynthesis.cancel() }
    }, [])

    useEffect(() => {
        setMessages([])
        setActiveSessionId(undefined)
        setSessions([])
        setError(null)
        setRetryingMessageId(null)
    }, [workspaceId])

    useEffect(() => {
        if (!workspaceId) return
        loadSessions()
    }, [workspaceId])

    const loadSessions = async () => {
        if (!workspaceId) return
        try {
            const list = await ragAPI.getWorkspaceSessions(workspaceId)
            setSessions(list)
        } catch {/* non-critical */}
    }

    const loadSession = async (sessionId: string) => {
        try {
            const history = await ragAPI.getSessionHistory(sessionId)
            const formatted: Message[] = history.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: new Date(m.created_at),
                selectedText: m.selected_text || undefined,
                source: m.source,
                sourceDocumentName: m.source_document_name,
                origin: m.role === "assistant" ? "chat" : undefined,
            }))
            setMessages(formatted)
            setActiveSessionId(sessionId)
            setShowSessions(false)
        } catch {
            setError("Failed to load session")
        }
    }

    const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            await ragAPI.deleteSession(sessionId)
            setSessions((prev) => prev.filter((s) => s.id !== sessionId))
            if (activeSessionId === sessionId) {
                setMessages([])
                setActiveSessionId(undefined)
            }
        } catch {
            setError("Failed to delete session")
        }
    }

    const startNewChat = () => {
        setMessages([])
        setActiveSessionId(undefined)
        setShowSessions(false)
        setError(null)
        setRetryingMessageId(null)
    }

    const stopSpeech = () => {
        if (!speechSupported) return
        window.speechSynthesis.cancel()
        setActiveSpeechId(null)
    }

    const speakMessage = (id: string, content: string) => {
        if (!speechSupported) {
            setError("Text-to-speech is not supported in this browser")
            return
        }
        if (activeSpeechId === id) { stopSpeech(); return }
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(content)
        u.rate = 1
        u.onend = () => setActiveSpeechId(null)
        u.onerror = () => setActiveSpeechId(null)
        setActiveSpeechId(id)
        window.speechSynthesis.speak(u)
    }

    const handleSend = async () => {
        if (!input.trim() || !workspaceId) return

        const userInput = input
        const userSelected = selectedText
        const userMsg: Message = {
            id: Date.now().toString(),
            role: "user",
            content: userInput,
            timestamp: new Date(),
            selectedText: userSelected || undefined,
        }
        setMessages((prev) => [...prev, userMsg])
        setInput("")
        setIsLoading(true)
        setError(null)

        try {
            const resp = await ragAPI.query({
                query: userInput,
                workspaceId,
                documentId: documentId || undefined,
                selectedText: userSelected || undefined,
                sessionId: activeSessionId,
            })

            const asst: Message = {
                id: resp.messageId || Date.now().toString(),
                role: "assistant",
                content: resp.response,
                timestamp: new Date(),
                source: resp.source,
                sourceDocumentName: resp.sourceDocumentName,
                origin: "chat",
            }
            setMessages((prev) => [...prev, asst])
            onClearSelection?.()

            // Bind future messages to this session so we keep continuity
            if (resp.sessionId && !activeSessionId) {
                setActiveSessionId(resp.sessionId)
                setTimeout(() => loadSessions(), 300)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error"
            setError(msg)
            setMessages((prev) => [...prev, {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: `⚠ ${msg}`,
                timestamp: new Date(),
                origin: "chat",
            }])
        } finally {
            setIsLoading(false)
        }
    }

    const getRetryPayload = (assistantIndex: number) => {
        if (!workspaceId) return null
        for (let i = assistantIndex - 1; i >= 0; i -= 1) {
            const msg = messages[i]
            if (msg.role === "user") {
                return {
                    query: msg.content,
                    selectedText: msg.selectedText,
                    workspaceId,
                    documentId: documentId || undefined,
                }
            }
        }
        return null
    }

    const handleRetry = async (assistantIndex: number, messageId: string) => {
        if (isLoading) return
        const payload = getRetryPayload(assistantIndex)
        if (!payload) {
            setError("Nothing to retry yet")
            return
        }

        setIsLoading(true)
        setError(null)
        setRetryingMessageId(messageId)
        setMessages((prev) => prev.filter((m) => m.id !== messageId))

        try {
            const resp = await ragAPI.query({
                query: payload.query,
                workspaceId: payload.workspaceId,
                documentId: payload.documentId,
                selectedText: payload.selectedText,
                sessionId: activeSessionId,
            })

            const updated: Message = {
                id: resp.messageId || Date.now().toString(),
                role: "assistant",
                content: resp.response,
                timestamp: new Date(),
                source: resp.source,
                sourceDocumentName: resp.sourceDocumentName,
                origin: "chat",
            }

            setMessages((prev) => [...prev, updated])
            onClearSelection?.()

            if (resp.sessionId && resp.sessionId !== activeSessionId) {
                setActiveSessionId(resp.sessionId)
                setTimeout(() => loadSessions(), 300)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error"
            setError(msg)
            setMessages((prev) => [...prev, {
                id: Date.now().toString(),
                role: "assistant",
                content: `⚠ ${msg}`,
                timestamp: new Date(),
                source: "none",
                sourceDocumentName: undefined,
                origin: "chat",
            }])
        } finally {
            setIsLoading(false)
            setRetryingMessageId(null)
        }
    }

    const placeholder = !workspaceId
        ? "Select a workspace first..."
        : documentId
            ? "Ask about this document (or the workspace)..."
            : "Ask about your workspace documents..."

    const sourceLabel = (m: Message) => {
        if (m.source === "document" && m.sourceDocumentName) {
            return { icon: <FileText className="w-3 h-3" />, text: m.sourceDocumentName }
        }
        if (m.source === "workspace") {
            return {
                icon: <Globe className="w-3 h-3" />,
                text: m.sourceDocumentName ? `Workspace · ${m.sourceDocumentName}` : "Workspace",
            }
        }
        return null
    }

    const latestAssistantIndex = (() => {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            if (messages[i].role === "assistant") return i
        }
        return -1
    })()

    return (
        <div className="flex flex-col h-full bg-card min-h-0">
            {/* Header */}
            <div className="border-b border-border px-4 py-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-primary" />
                        <span className="font-semibold text-foreground text-sm">AI Chat</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowSessions((v) => !v)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted transition-colors ${showSessions ? "bg-muted" : ""}`}
                            title="Chat history"
                        >
                            <History className="w-3 h-3" /> History
                        </button>
                        <button
                            onClick={startNewChat}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted transition-colors"
                            title="New chat"
                        >
                            <Plus className="w-3 h-3" /> New
                        </button>
                    </div>
                </div>
            </div>

            {/* Session history — scrollable */}
            {showSessions && (
                <div className="border-b border-border bg-muted/30 flex-shrink-0 overflow-y-auto" style={{ maxHeight: "40vh" }}>
                    {sessions.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">No chat history yet.</p>
                    ) : (
                        sessions.map((s) => (
                            <div
                                key={s.id}
                                onClick={() => loadSession(s.id)}
                                className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted transition-colors border-b border-border/30 last:border-0 ${activeSessionId === s.id ? "bg-muted" : ""}`}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium truncate">{s.title}</p>
                                    <p className="text-[10px] text-muted-foreground">{new Date(s.updated_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => handleDeleteSession(s.id, e)}
                                    className="hidden group-hover:block p-0.5 rounded hover:bg-destructive/20 text-destructive flex-shrink-0 ml-2"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                        <MessageCircle className="w-10 h-10 text-muted-foreground opacity-30" />
                        <p className="text-sm text-muted-foreground">
                            {documentId ? "Ask about this document" : "Ask anything about your documents"}
                        </p>
                    </div>
                )}

                {messages.map((message, index) => {
                    const isUser = message.role === "user"
                    const src = !isUser ? sourceLabel(message) : null
                    const isLatestAssistant = !isUser && message.origin === "chat" && index === latestAssistantIndex
                    const retryPayload = isLatestAssistant ? getRetryPayload(index) : null
                    const showRetry = Boolean(retryPayload)
                    return (
                        <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                            <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[85%]`}>
                                <div className={`rounded-lg overflow-hidden ${isUser ? "bg-primary text-primary-foreground rounded-br-none" : "bg-muted text-foreground rounded-bl-none"}`}>
                                    {/* Selected-text context header (user bubble only) */}
                                    {isUser && message.selectedText && (
                                        <div className="bg-black/15 px-3 py-1.5 border-b border-white/10">
                                            <p className="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">Context</p>
                                            <p className="text-xs italic line-clamp-2 opacity-90">&ldquo;{message.selectedText}&rdquo;</p>
                                        </div>
                                    )}

                                    <div className="px-3 py-2">
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>

                                        {/* Source attribution on assistant bubble */}
                                        {src && (
                                            <div className="flex items-center gap-1 mt-1.5 text-[10px] opacity-70">
                                                {src.icon}
                                                <span className="truncate">From: {src.text}</span>
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between mt-1 gap-2">
                                            <span className="text-[10px] opacity-60">
                                                {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                            {!isUser && (
                                                <div className="flex gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => navigator.clipboard.writeText(message.content).catch(() => null)}
                                                        className="p-1 rounded hover:bg-background/40 opacity-60 hover:opacity-100 transition-opacity"
                                                        title="Copy"
                                                    >
                                                        <Copy className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => speakMessage(message.id, message.content)}
                                                        disabled={!speechSupported}
                                                        className="p-1 rounded hover:bg-background/40 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                                                        title={activeSpeechId === message.id ? "Stop reading" : "Read aloud"}
                                                    >
                                                        {activeSpeechId === message.id ? <Square className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {showRetry && (
                                    <button
                                        type="button"
                                        onClick={() => handleRetry(index, message.id)}
                                        disabled={isLoading}
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                        title="Retry last question"
                                    >
                                        <RotateCcw className={`w-3 h-3 ${retryingMessageId === message.id ? "animate-spin" : ""}`} />
                                        {retryingMessageId === message.id ? "Retrying" : "Retry"}
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}

                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-muted px-4 py-3 rounded-lg rounded-bl-none flex gap-1.5">
                            {[0, 0.15, 0.3].map((delay, i) => (
                                <div key={i} className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: `${delay}s` }} />
                            ))}
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick actions */}
            {workspaceId && (
                <div className="px-4 py-2 border-t border-border flex-shrink-0">
                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                if (!documentId || !workspaceId) {
                                    setError("Select a document to summarize")
                                    return
                                }
                                setIsSummarizing(true)
                                setError(null)
                                try {
                                    const result = await agenticRAG.summarize(documentId, workspaceId, "key_points")
                                    const summaryMsg: Message = {
                                        id: Date.now().toString(),
                                        role: "assistant",
                                        content: `**Summary of ${result.document_name}**\n\n${result.summary}\n\n**Key Points:**\n${result.key_points.map(p => `• ${p}`).join('\n')}`,
                                        timestamp: new Date(),
                                        source: "document",
                                        sourceDocumentName: result.document_name,
                                        origin: "summary",
                                    }
                                    setMessages(prev => [...prev, summaryMsg])
                                } catch (err) {
                                    setError(err instanceof Error ? err.message : "Failed to summarize")
                                } finally {
                                    setIsSummarizing(false)
                                }
                            }}
                            disabled={isSummarizing || !documentId}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-muted hover:bg-muted/80 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                            {isSummarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileBarChart className="w-3 h-3" />}
                            Summarize
                        </button>
                        <button
                            onClick={() => onOpenQuiz?.()}
                            disabled={!documentId}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-muted hover:bg-muted/80 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                            <Brain className="w-3 h-3" />
                            Quiz me
                        </button>
                    </div>
                </div>
            )}

            {/* Input */}
            <div className="border-t border-border p-3 flex-shrink-0 space-y-2">
                {error && (
                    <div className="bg-destructive/10 text-destructive text-xs p-2 rounded">{error}</div>
                )}
                {selectedText && (
                    <div className="flex items-start gap-2 text-xs text-primary bg-primary/10 px-2 py-1.5 rounded">
                        <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span className="flex-1 line-clamp-2 italic">&ldquo;{selectedText}&rdquo;</span>
                        <button
                            onClick={onClearSelection}
                            className="text-primary/60 hover:text-primary flex-shrink-0"
                            title="Clear selection"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                        placeholder={placeholder}
                        disabled={!workspaceId || isLoading}
                        className="flex-1 px-3 py-2 rounded-lg bg-input text-foreground placeholder-muted-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm disabled:opacity-50"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading || !workspaceId}
                        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    )
}
