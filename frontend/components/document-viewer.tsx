"use client"

import { useState } from "react"
import { ZoomIn, ZoomOut, Download, Share2, Highlighter } from "lucide-react"
import { Button } from "@/components/ui/button"

export function DocumentViewer() {
  const [zoom, setZoom] = useState(100)
  const [selectedText, setSelectedText] = useState("")

  const handleTextSelection = () => {
    const selection = window.getSelection()
    if (selection) {
      setSelectedText(selection.toString())
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Zoom:</span>
          <Button variant="outline" size="sm" onClick={() => setZoom(Math.max(50, zoom - 10))} className="gap-1">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
          <Button variant="outline" size="sm" onClick={() => setZoom(Math.min(200, zoom + 10))} className="gap-1">
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 hidden sm:flex bg-transparent">
            <Highlighter className="w-4 h-4" />
            Highlight
          </Button>
          <Button variant="outline" size="sm" className="gap-2 hidden sm:flex bg-transparent">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button variant="outline" size="sm" className="gap-2 bg-transparent">
            <Share2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Document Content */}
      <div className="flex-1 overflow-auto p-4 md:p-8 bg-background">
        <div
          className="max-w-4xl mx-auto bg-white rounded-lg shadow-lg p-8 text-foreground"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
          onMouseUp={handleTextSelection}
        >
          {/* Sample Document Content */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">Introduction to Cellular Biology</h1>
              <p className="text-sm text-muted-foreground">Chapter 3: Cell Structure and Function</p>
            </div>

            <div className="space-y-4">
              <h2 className="text-2xl font-semibold">The Cell Membrane</h2>
              <p className="leading-relaxed text-justify">
                The cell membrane, also known as the plasma membrane, is a thin, flexible barrier that surrounds the
                cell and controls what enters and exits. It is composed primarily of a phospholipid bilayer with
                embedded proteins. This structure is often referred to as the "fluid mosaic model" because the
                components are not rigidly fixed but can move laterally within the membrane.
              </p>
              <p className="leading-relaxed text-justify">
                The phospholipid bilayer consists of two layers of phospholipid molecules arranged with their
                hydrophobic tails facing inward and their hydrophilic heads facing outward. This arrangement allows the
                membrane to be selectively permeable, meaning it allows some substances to pass through while blocking
                others.
              </p>
            </div>

            <div className="bg-muted p-4 rounded-lg border-l-4 border-accent">
              <p className="font-semibold text-sm mb-2">Key Concept:</p>
              <p className="text-sm">
                The cell membrane is not a static barrier but a dynamic structure that regulates cellular communication
                and maintains homeostasis.
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold">Membrane Proteins</h3>
              <p className="leading-relaxed text-justify">
                Proteins embedded in or attached to the cell membrane perform various functions including transport,
                recognition, and cell signaling. There are two main types of membrane proteins: integral proteins that
                span the entire membrane, and peripheral proteins that are attached to the surface.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 my-6">
              <div className="bg-accent/10 p-4 rounded-lg">
                <h4 className="font-semibold text-sm mb-2">Integral Proteins</h4>
                <p className="text-sm text-muted-foreground">
                  Span the entire membrane, involved in transport and signaling
                </p>
              </div>
              <div className="bg-accent/10 p-4 rounded-lg">
                <h4 className="font-semibold text-sm mb-2">Peripheral Proteins</h4>
                <p className="text-sm text-muted-foreground">
                  Attached to membrane surface, provide structural support
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selection Highlight */}
      {selectedText && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-accent text-accent-foreground p-3 rounded-lg shadow-lg text-sm">
          <p className="font-semibold mb-1">Selected Text:</p>
          <p className="line-clamp-2 italic">"{selectedText}"</p>
          <p className="text-xs mt-2 opacity-75">Right-click to ask AI about this</p>
        </div>
      )}
    </div>
  )
}
