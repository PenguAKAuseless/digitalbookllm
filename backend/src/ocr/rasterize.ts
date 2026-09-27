import { createCanvas, Canvas } from '@napi-rs/canvas';
// Legacy build targets Node (no DOM/worker requirements).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Minimal CanvasFactory so pdf.js can render pages without a browser DOM. */
class NodeCanvasFactory {
    create(width: number, height: number) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext('2d') };
    }
    reset(canvasAndContext: { canvas: Canvas }, width: number, height: number) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }
    destroy(canvasAndContext: { canvas: Canvas | null }) {
        canvasAndContext.canvas = null;
    }
}

export interface RasterizedPage {
    pageNumber: number;
    png: Buffer;
}

/**
 * Renders PDF pages to PNG buffers at `scale` (default ~150 DPI equivalent).
 * Used for (a) the library cover thumbnail and (b) OCR input for scanned
 * PDFs that have no extractable text layer.
 */
export async function rasterizePdfPages(
    pdfBuffer: Buffer,
    pageNumbers: number[],
    scale = 1.5
): Promise<RasterizedPage[]> {
    const factory = new NodeCanvasFactory();
    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        useSystemFonts: true,
        canvasFactory: factory,
    } as any);
    const doc = await loadingTask.promise;
    const results: RasterizedPage[] = [];

    try {
        for (const pageNumber of pageNumbers) {
            if (pageNumber < 1 || pageNumber > doc.numPages) continue;
            const page = await doc.getPage(pageNumber);
            const viewport = page.getViewport({ scale });
            const { canvas, context } = factory.create(viewport.width, viewport.height);

            await page.render({ canvasContext: context as any, viewport }).promise;
            results.push({ pageNumber, png: canvas.toBuffer('image/png') });
            page.cleanup();
        }
    } finally {
        await doc.destroy();
    }

    return results;
}

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
    const count = doc.numPages;
    await doc.destroy();
    return count;
}
