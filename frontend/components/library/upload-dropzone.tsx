"use client"

import { useCallback, useRef, useState } from "react"
import { UploadCloud } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface UploadDropzoneProps {
    onFileSelected: (file: File) => void
    disabled?: boolean
}

const ACCEPTED_EXTENSIONS = [".pdf", ".epub", ".docx", ".txt", ".md"]

/** Drag-and-drop upload target for the library screen (UC05). */
export function UploadDropzone({ onFileSelected, disabled }: UploadDropzoneProps) {
    const { t } = useI18n()
    const [isDragging, setIsDragging] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            setIsDragging(false)
            if (disabled) return
            const file = e.dataTransfer.files?.[0]
            if (file) onFileSelected(file)
        },
        [disabled, onFileSelected]
    )

    return (
        <div
            onDragOver={(e) => {
                e.preventDefault()
                if (!disabled) setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !disabled && inputRef.current?.click()}
            className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                disabled && "pointer-events-none opacity-50"
            )}
        >
            <UploadCloud className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm font-medium">{t("library.upload")}</p>
            <p className="text-xs text-muted-foreground">{t("library.uploadHint")}</p>
            <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS.join(",")}
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onFileSelected(file)
                    e.target.value = ""
                }}
            />
        </div>
    )
}
