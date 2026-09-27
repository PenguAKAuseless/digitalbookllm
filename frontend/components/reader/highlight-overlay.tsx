"use client"

import { Highlight } from "@/lib/api/highlights"

interface HighlightOverlayProps {
    highlights: Highlight[]
    pageWidth: number
    pageHeight: number
}

/** Renders saved highlight rects on top of a rendered PDF page (UC11). */
export function HighlightOverlay({ highlights, pageWidth, pageHeight }: HighlightOverlayProps) {
    return (
        <div className="absolute inset-0 pointer-events-none">
            {highlights
                .filter((h) => h.type === "HIGHLIGHT")
                .flatMap((h) =>
                    h.location_meta.rects.map((rect, i) => (
                        <div
                            key={`${h.id}-${i}`}
                            className="absolute mix-blend-multiply"
                            style={{
                                left: rect.x * pageWidth,
                                top: rect.y * pageHeight,
                                width: rect.width * pageWidth,
                                height: rect.height * pageHeight,
                                backgroundColor: h.color,
                                opacity: 0.45,
                            }}
                            title={h.note ?? undefined}
                        />
                    ))
                )}
        </div>
    )
}
