"use client"

import { useState, useRef, useEffect } from "react"
import { Send, MessageCircle, Zap, Copy, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ragAPI, QueryCount } from "@/lib/api/rag"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

interface ChatPanelProps {
  onViewChange?: (view: "document" | "chat") => void
  documentId?: string
  selectedText?: string
}

export function ChatPanel({ onViewChange, documentId, selectedText }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Hi! I'm your AI study buddy. Select text from the document or ask me anything about it. I can explain concepts, generate quizzes, or help you understand complex topics.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [queryCount, setQueryCount] = useState<QueryCount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    loadQueryCount()
  }, [])

  useEffect(() => {
    if (documentId) {
      loadChatHistory()
    }
  }, [documentId])

  const loadQueryCount = async () => {
    try {
      const count = await ragAPI.getQueryCount()
      setQueryCount(count)
    } catch (error) {
      console.error('Failed to load query count:', error)
    }
  }

  const loadChatHistory = async () => {
    if (!documentId) return

    try {
      const history = await ragAPI.getChatHistory(documentId)
      if (history.length > 0) {
        const formattedMessages = history.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.created_at)
        }))
        setMessages(formattedMessages)
      }
    } catch (error) {
      console.error('Failed to load chat history:', error)
    }
  }

  const handleSendMessage = async () => {
    if (!input.trim() || !documentId) {
      if (!documentId) {
        setError('Please select a document first')
      }
      return
    }

    setError(null)
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await ragAPI.query({
        query: input,
        documentId,
        selectedText,
        topK: 3,
      })

      const assistantMessage: Message = {
        id: response.messageId,
        role: "assistant",
        content: response.response,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      await loadQueryCount() // Update query count
    } catch (error: any) {
      console.error('Query failed:', error)
      setError(error.message || 'Failed to get response. Please try again.')

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${error.message || 'Unknown error'}. Please try again.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const quickPrompts = [
    { icon: Zap, label: "Explain Simply", prompt: "Explain this concept in simple terms" },
    { icon: MessageCircle, label: "Quiz Me", prompt: "Generate a quiz question about this" },
  ]

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 md:py-4">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-accent" />
          AI Study Buddy
        </h2>
        <p className="text-xs text-muted-foreground mt-1">Context-aware learning assistant</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-xs md:max-w-sm lg:max-w-md px-4 py-3 rounded-lg ${message.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-none"
                : "bg-muted text-foreground rounded-bl-none"
                }`}
            >
              <p className="text-sm leading-relaxed">{message.content}</p>
              <p className="text-xs mt-2 opacity-70">
                {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>

              {/* Message Actions */}
              {message.role === "assistant" && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-border/50">
                  <button className="p-1 hover:bg-background/50 rounded transition-colors">
                    <Copy className="w-3 h-3" />
                  </button>
                  <button className="p-1 hover:bg-background/50 rounded transition-colors">
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button className="p-1 hover:bg-background/50 rounded transition-colors">
                    <ThumbsDown className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted text-foreground px-4 py-3 rounded-lg rounded-bl-none">
              <div className="flex gap-2">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                />
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      {messages.length === 1 && (
        <div className="px-4 py-3 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.label}
                onClick={() => {
                  setInput(prompt.prompt)
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-medium transition-colors"
              >
                <prompt.icon className="w-3 h-3" />
                {prompt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-border p-4 space-y-3">
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-2 rounded">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
            placeholder={documentId ? "Ask about the document..." : "Select a document first..."}
            disabled={!documentId || isLoading}
            className="flex-1 px-4 py-2 rounded-lg bg-input text-foreground placeholder-muted-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm disabled:opacity-50"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || !documentId}
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
            size="sm"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {queryCount
              ? `${queryCount.used}/${queryCount.limit} queries used today`
              : 'Loading...'}
          </span>
          <span>Powered by Together AI</span>
        </div>
      </div>
    </div>
  )
}
