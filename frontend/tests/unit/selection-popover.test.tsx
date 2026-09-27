import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SelectionPopover, SelectionInfo } from "@/components/reader/selection-popover"
import { I18nProvider } from "@/lib/i18n"

const selection: SelectionInfo = {
    text: "sample selected text",
    page: 3,
    rects: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.02 }],
    anchor: { top: 100, left: 100 },
}

function renderPopover(handlers: Partial<Parameters<typeof SelectionPopover>[0]> = {}) {
    return render(
        <I18nProvider>
            <SelectionPopover
                selection={selection}
                onHighlight={vi.fn()}
                onNote={vi.fn()}
                onSpeak={vi.fn()}
                onAskAI={vi.fn()}
                {...handlers}
            />
        </I18nProvider>
    )
}

// Covers the four contextual actions required by Luồng 1 / UC11 / UC12 / UC14.
describe("SelectionPopover", () => {
    it("renders all four contextual actions", () => {
        renderPopover()
        expect(screen.getAllByTitle(/Highlight|Đánh dấu/i).length).toBeGreaterThan(0)
        expect(screen.getByTitle(/Note|Ghi chú/i)).toBeInTheDocument()
        expect(screen.getByTitle(/Speak|Đọc to/i)).toBeInTheDocument()
        expect(screen.getByTitle(/Ask AI|Hỏi AI/i)).toBeInTheDocument()
    })

    it("calls onSpeak when the speak button is clicked", () => {
        const onSpeak = vi.fn()
        renderPopover({ onSpeak })
        fireEvent.click(screen.getByTitle(/Speak|Đọc to/i))
        expect(onSpeak).toHaveBeenCalledTimes(1)
    })

    it("calls onAskAI when the ask-AI button is clicked", () => {
        const onAskAI = vi.fn()
        renderPopover({ onAskAI })
        fireEvent.click(screen.getByTitle(/Ask AI|Hỏi AI/i))
        expect(onAskAI).toHaveBeenCalledTimes(1)
    })

    it("opens a note editor and saves the typed note", () => {
        const onNote = vi.fn()
        renderPopover({ onNote })
        fireEvent.click(screen.getByTitle(/Note|Ghi chú/i))
        const textarea = screen.getByPlaceholderText(/note|ghi chú/i)
        fireEvent.change(textarea, { target: { value: "my note" } })
        fireEvent.click(screen.getByText(/Save|Lưu/i))
        expect(onNote).toHaveBeenCalledWith("my note")
    })
})
