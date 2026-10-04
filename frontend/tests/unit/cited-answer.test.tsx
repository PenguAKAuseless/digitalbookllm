import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CitedAnswer } from "@/components/chat/cited-answer"
import { Citation } from "@/lib/api/rag"
import { I18nProvider } from "@/lib/i18n"

const citation = (n: number, documentName: string, page: number): Citation => ({
    chunkId: `c${n}`,
    documentId: `doc-${documentName}`,
    documentName,
    page,
    text: `passage ${n}`,
    similarity: 0.5,
})

const citations = [citation(1, "Volume 2.txt", 1), citation(2, "Volume 2.txt", 4), citation(3, "Volume 1.txt", 1)]

function renderAnswer(text: string, onCitationClick = vi.fn()) {
    render(
        <I18nProvider>
            <CitedAnswer text={text} citations={citations} onCitationClick={onCitationClick} />
        </I18nProvider>
    )
    return onCitationClick
}

// UC13: [n] markers in an answer link to their source passage.
describe("CitedAnswer", () => {
    it("turns each [n] marker into a link named after its source book and page", () => {
        renderAnswer("Shirley Temple starred in Kiss and Tell [1]. She was Chief of Protocol [3].")
        expect(screen.getByRole("button", { name: /\[1\] Volume 2\.txt/ })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /\[3\] Volume 1\.txt/ })).toBeInTheDocument()
        expect(screen.queryByText("[1]")).not.toBeInTheDocument()
    })

    it("opens the cited passage on click, including one from another book", () => {
        const onClick = renderAnswer("Chief of Protocol [3].")
        fireEvent.click(screen.getByRole("button", { name: /\[3\]/ }))
        expect(onClick).toHaveBeenCalledWith(citations[2])
    })

    it("splits grouped markers [1, 2] into one link per passage", () => {
        renderAnswer("Both say so [1, 2].")
        expect(screen.getAllByRole("button")).toHaveLength(2)
    })

    it("leaves a marker that points past the retrieved passages as plain text", () => {
        renderAnswer("Unknown source [7].")
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
        expect(screen.getByText(/\[7\]/)).toBeInTheDocument()
    })
})
