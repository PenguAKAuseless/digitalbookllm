import { createWorker } from 'tesseract.js';
import { rasterizePdfPages, getPdfPageCount } from './rasterize';

/**
 * Basic OCR fallback for image-only PDFs (FR03, NFR03.1). Only triggered when
 * the text-layer extraction pass (pdf-parse) returns no usable text. A
 * moderate error rate is accepted per NFR03.1 — this is not the project's
 * optimization target.
 */
export async function ocrPdf(pdfBuffer: Buffer, languages = 'eng+vie'): Promise<{ text: string; pageCount: number }> {
    const pageCount = await getPdfPageCount(pdfBuffer);
    const worker = await createWorker(languages);
    let combined = '';

    try {
        // Render and recognize page by page to keep peak memory bounded on a
        // free-tier container.
        for (let page = 1; page <= pageCount; page++) {
            const [rasterized] = await rasterizePdfPages(pdfBuffer, [page], 2.0);
            if (!rasterized) continue;
            const { data } = await worker.recognize(rasterized.png);
            if (data.text.trim()) combined += `\n\n[page ${page}]\n${data.text}`;
        }
    } finally {
        await worker.terminate();
    }

    return { text: combined.trim(), pageCount };
}
