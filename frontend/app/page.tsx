"use client"

import { useState } from "react"
import { DocumentViewer } from "@/components/document-viewer"
import { ChatPanel } from "@/components/chat-panel"
import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileView, setMobileView] = useState<"document" | "chat">("document")

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Hidden on mobile, visible on tablet+ */}
        <div
          className={`${sidebarOpen ? "w-64" : "w-0"} hidden md:block transition-all duration-300 border-r border-border bg-sidebar`}
        >
          <Sidebar />
        </div>

        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden bg-black/50" onClick={() => setSidebarOpen(false)}>
            <div className="w-64 h-full bg-sidebar border-r border-border" onClick={(e) => e.stopPropagation()}>
              <Sidebar />
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Document Viewer - Full width on mobile, 70% on desktop */}
          <div
            className={`${mobileView === "document" ? "flex-1" : "hidden md:flex md:flex-1"} flex flex-col border-r border-border`}
          >
            <DocumentViewer />
          </div>

          {/* Chat Panel - Full width on mobile, 30% on desktop */}
          <div className={`${mobileView === "chat" ? "flex-1" : "hidden md:flex md:w-[30%]"} flex flex-col bg-card`}>
            <ChatPanel onViewChange={setMobileView} />
          </div>

          {/* Mobile Toggle Buttons */}
          <div className="md:hidden absolute bottom-4 right-4 flex gap-2 z-30">
            <button
              onClick={() => setMobileView("document")}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mobileView === "document" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Document
            </button>
            <button
              onClick={() => setMobileView("chat")}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                mobileView === "chat" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Chat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
