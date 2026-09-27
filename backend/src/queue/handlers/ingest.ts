import { v4 as uuid } from 'uuid';
import { pool } from '../../db/config';
import { storage } from '../../storage';
import { Job } from '../jobQueue';
import { extractText, offsetToPage } from '../../ingestion/extractText';
import { ocrPdf } from '../../ocr/ocr';
import { rasterizePdfPages } from '../../ocr/rasterize';
import { chunker } from '../../chunking/chunker';
import { embeddingService } from '../../llm/embeddings';
import { enqueue } from '../jobQueue';

interface IngestPayload {
    documentId: string;
    storageKey: string;
    fileType: string;
    fileName: string;
    userId: string;
}

/**
 * Worker 1 (Ingestion), per the specified architecture: extract text -> OCR
 * fallback for image-only PDFs -> two-level chunking -> embedding -> persist.
 * Runs as one step of the PostgreSQL job queue (see ADR-02).
 */
export async function handleIngestDocument(job: Job): Promise<void> {
    const { documentId, storageKey, fileType, fileName, userId } = job.payload as unknown as IngestPayload;

    await setStatus(documentId, 'PROCESSING');

    const fileBuffer = await storage().get(storageKey);
    const isPdf = fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

    let extracted = await extractText(fileBuffer, fileType, fileName).catch(() => null);
    let usedOcr = false;

    if (isPdf && (!extracted || extracted.fullText.trim().length < 20)) {
        const ocrResult = await ocrPdf(fileBuffer);
        extracted = {
            fullText: ocrResult.text,
            pageBoundaries: [], // OCR path does not track fine-grained page offsets; whole-doc chunking below.
            pageCount: ocrResult.pageCount,
            usedOcr: true,
        };
        usedOcr = true;
    }

    if (!extracted || !extracted.fullText.trim()) {
        await setStatus(documentId, 'FAILED', 'No extractable text found in the uploaded file.');
        return;
    }

    // Cover thumbnail for the library grid (ADR-09): render page 1 once at ingestion time.
    let coverKey: string | null = null;
    if (isPdf) {
        try {
            const [firstPage] = await rasterizePdfPages(fileBuffer, [1], 1.0);
            if (firstPage) {
                coverKey = `${storageKey}.cover.png`;
                await storage().put(coverKey, firstPage.png, 'image/png');
            }
        } catch (err) {
            console.warn(`[ingest] cover render failed for ${documentId}:`, err);
        }
    }

    const chunks = await chunker.chunk(extracted.fullText);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);

        for (let i = 0; i < chunks.length; i++) {
            const embedding = await embeddingService.generateEmbedding(chunks[i].text);
            const pageNumber = offsetToPage(chunks[i].startOffset, extracted.pageBoundaries);
            await client.query(
                `INSERT INTO chunks (id, document_id, user_id, chunk_index, page_number, text, embedding)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [uuid(), documentId, userId, i, pageNumber, chunks[i].text, JSON.stringify(embedding)]
            );
        }

        await client.query(
            `UPDATE documents
             SET full_text = $2, status = 'READY', status_detail = NULL, ocr_used = $3,
                 page_count = $4, cover_key = $5, updated_at = NOW()
             WHERE id = $1`,
            [documentId, extracted.fullText, usedOcr, extracted.pageCount, coverKey]
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    // Kick off knowledge extraction in the background; it must not block marking the document READY.
    await enqueue('EXTRACT_ENTITIES', { documentId, userId });
}

async function setStatus(documentId: string, status: string, detail?: string): Promise<void> {
    await pool.query(
        `UPDATE documents SET status = $2, status_detail = $3, updated_at = NOW() WHERE id = $1`,
        [documentId, status, detail ?? null]
    );
}
