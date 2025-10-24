"use client"

import { FileText, Plus, Clock, Star, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Sidebar() {
  const documents = [
    { id: 1, name: "Biology Textbook Ch. 3", date: "2 days ago", icon: FileText },
    { id: 2, name: "Research Paper - AI", date: "1 week ago", icon: FileText },
    { id: 3, name: "Python Guide", date: "2 weeks ago", icon: FileText },
  ]

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Upload Section */}
      <div className="p-4 border-b border-sidebar-border">
        <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
          <Plus className="w-4 h-4" />
          Upload Document
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-2">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider px-2 py-2">
            Quick Access
          </h3>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors">
            <Clock className="w-4 h-4" />
            <span className="text-sm">Recent</span>
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors">
            <Star className="w-4 h-4" />
            <span className="text-sm">Favorites</span>
          </button>
        </div>

        {/* Documents List */}
        <div className="space-y-1 pt-4">
          <h3 className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider px-2 py-2">
            My Documents
          </h3>
          {documents.map((doc) => (
            <button
              key={doc.id}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors group"
            >
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-sidebar-foreground">{doc.name}</p>
                  <p className="text-xs text-sidebar-foreground/60">{doc.date}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border space-y-2">
        <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
          <FolderOpen className="w-4 h-4" />
          Manage Library
        </button>
      </div>
    </div>
  )
}
