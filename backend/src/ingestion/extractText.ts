import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface ExtractedText {
    fullText: string;
    /** Cumulative starting character offset of each page, 0-indexed by page. Empty for non-paged formats. */
    pageBoundaries: number[];
    pageCount: number;
    usedOcr: boolean;
}

const SYNTHETIC_PAGE_CHARS = 3000;

/** Extracts text and (for PDFs) a page-offset map, without falling back to OCR. */
export async function extractText(buffer: Buffer, fileType: string, fileName: string): Promise<ExtractedText> {
    const normalized = (fileType || '').toLowerCase();
    const ext = (fileName || '').toLowerCase();
    const isPdf = normalized === 'application/pdf' || ext.endsWith('.pdf');
    const isDocx =
        normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext.endsWith('.docx');

    if (isPdf) {
        const pageTexts: string[] = [];
        await pdfParse(buffer, {
            // pdf-parse calls this once per page during parsing; capturing the
            // per-page text lets us map chunk offsets back to page numbers.
            pagerender: async (pageData: any) => {
                const content = await pageData.getTextContent();
                const text = content.items.map((item: any) => item.str).join(' ');
                pageTexts.push(text);
                return text;
            },
        });

        const boundaries: number[] = [];
        let offset = 0;
        for (const pageText of pageTexts) {
            boundaries.push(offset);
            offset += pageText.length + 2; // matches the "\n\n" join below
        }
        const fullText = pageTexts.join('\n\n');

        return { fullText, pageBoundaries: boundaries, pageCount: pageTexts.length, usedOcr: false };
    }

    if (isDocx) {
        const result = await mammoth.extractRawText({ buffer });
        return syntheticPaging(result.value);
    }

    if (!buffer.includes(0)) {
        return syntheticPaging(buffer.toString('utf-8'));
    }

    throw new Error('Unsupported or unreadable file type');
}

function syntheticPaging(text: string): ExtractedText {
    const pageCount = Math.max(1, Math.ceil(text.length / SYNTHETIC_PAGE_CHARS));
    const pageBoundaries = Array.from({ length: pageCount }, (_, i) => i * SYNTHETIC_PAGE_CHARS);
    return { fullText: text, pageBoundaries, pageCount, usedOcr: false };
}

/** Maps a character offset into `fullText` back to a 1-indexed page number. */
export function offsetToPage(offset: number, pageBoundaries: number[]): number {
    if (pageBoundaries.length === 0) return 1;
    let page = 1;
    for (let i = 0; i < pageBoundaries.length; i++) {
        if (pageBoundaries[i] <= offset) page = i + 1;
        else break;
    }
    return page;
}
