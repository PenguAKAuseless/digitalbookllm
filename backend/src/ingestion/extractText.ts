import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';

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

    const isEpub = normalized === 'application/epub+zip' || ext.endsWith('.epub');
    if (isEpub) {
        return syntheticPaging(await extractEpubText(buffer));
    }

    if (!buffer.includes(0)) {
        return syntheticPaging(buffer.toString('utf-8'));
    }

    throw new Error('Unsupported or unreadable file type');
}

/** Reads an EPUB's chapters in spine (reading) order and returns their text, one paragraph per line block. */
async function extractEpubText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const container = await zip.file('META-INF/container.xml')?.async('string');
    const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1];
    if (!opfPath) throw new Error('Invalid EPUB: missing container.xml');
    const opf = await zip.file(opfPath)?.async('string');
    if (!opf) throw new Error('Invalid EPUB: missing package document');
    const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    const manifest = new Map<string, string>();
    for (const item of opf.match(/<item\b[^>]*>/g) ?? []) {
        const id = /\bid="([^"]+)"/.exec(item)?.[1];
        const href = /\bhref="([^"]+)"/.exec(item)?.[1];
        const type = /\bmedia-type="([^"]+)"/.exec(item)?.[1] ?? '';
        // The EPUB 3 navigation document is a table of contents, not book text.
        const isNav = /\bproperties="[^"]*\bnav\b/.test(item);
        if (id && href && /html/.test(type) && !isNav) manifest.set(id, href);
    }
    const spine = (opf.match(/<itemref\b[^>]*>/g) ?? [])
        .map((ref) => /\bidref="([^"]+)"/.exec(ref)?.[1])
        .filter((id): id is string => !!id && manifest.has(id));

    const chapters: string[] = [];
    for (const id of spine) {
        const href = decodeURIComponent(manifest.get(id)!.split('#')[0]);
        const html = await zip.file(baseDir + href)?.async('string');
        if (html) chapters.push(htmlToText(html));
    }
    return chapters.filter(Boolean).join('\n\n');
}

function htmlToText(html: string): string {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    return body
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|blockquote|section|tr)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
