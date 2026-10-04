"use client"

import { KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from "react"

const DEFAULT_WIDTH = 256
const MIN_WIDTH = 180
const MAX_WIDTH = 480
const KEY_STEP = 16
const STORAGE_KEY = "reader.sidebarWidth"

const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)))

/**
 * Reader sidebar with a draggable right edge. The width is in pixels, so it
 * stays put when the window resizes, and is remembered in this browser.
 * Double-click the edge to reset; arrow keys resize it when it has focus.
 */
export function ResizableSidebar({ className = "", children }: { className?: string; children: ReactNode }) {
    const [width, setWidth] = useState(DEFAULT_WIDTH)
    const [dragging, setDragging] = useState(false)
    const start = useRef<{ x: number; width: number } | null>(null)

    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(STORAGE_KEY))
            if (saved) setWidth(clamp(saved))
        } catch {
            // Storage blocked: keep the default width.
        }
    }, [])

    const commit = (w: number) => {
        const next = clamp(w)
        setWidth(next)
        try {
            localStorage.setItem(STORAGE_KEY, String(next))
        } catch {
            // Not persisted; the width still applies for this visit.
        }
    }

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width }
        setDragging(true)
    }
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        if (start.current) setWidth(clamp(start.current.width + e.clientX - start.current.x))
    }
    const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
        if (!start.current) return
        commit(start.current.width + e.clientX - start.current.x)
        start.current = null
        setDragging(false)
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const delta = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[e.key]
        if (delta) {
            e.preventDefault()
            commit(width + delta)
        } else if (e.key === "Home") commit(MIN_WIDTH)
        else if (e.key === "End") commit(MAX_WIDTH)
    }

    return (
        <div className={`relative flex-shrink-0 border-r border-border bg-sidebar min-h-0 ${className}`} style={{ width }}>
            {children}
            <div
                role="separator"
                aria-orientation="vertical"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={MAX_WIDTH}
                aria-valuenow={width}
                tabIndex={0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={() => commit(DEFAULT_WIDTH)}
                onKeyDown={onKeyDown}
                className={`absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none ${
                    dragging ? "bg-primary" : ""
                }`}
            />
        </div>
    )
}
