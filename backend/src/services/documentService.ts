import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';
import { embeddingService } from './embeddingService';
import * as fs from 'fs';

export class DocumentService {
    private chunkSize = parseInt(process.env.CHUNK_SIZE || '500');
    private chunkOverlap = parseInt(process.env.CHUNK_OVERLAP || '50');

    private isProbablyText(buffer: Buffer): boolean {
        // Null bytes usually indicate binary data.
        return !buffer.includes(0);
    }

    async extractText(filePath: string, fileType: string, fileName?: string): Promise<string> {
        const buffer = fs.readFileSync(filePath);
        const normalizedType = (fileType || '').toLowerCase();
        const extension = (fileName || '').toLowerCase();
        const isPdf = normalizedType === 'application/pdf' || extension.endsWith('.pdf');
        const isDocx =
            normalizedType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            extension.endsWith('.docx');

        if (isPdf) {
            const pdfData = await pdfParse(buffer);
            if (pdfData.text?.trim()) {
                return pdfData.text;
            }
            throw new Error('PDF has no extractable text. OCR is required for scanned PDFs.');
        }

        if (isDocx) {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }

        switch (normalizedType) {
            case 'text/plain':
            case 'text/markdown':
            case 'application/json':
            case 'application/xml':
            case 'application/x-yaml':
            case 'application/yaml':
            case 'application/javascript':
            case 'application/x-javascript':
            case 'application/typescript':
                return buffer.toString('utf-8');

            default:
                if (normalizedType.startsWith('text/') || /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|log|ini|cfg|conf|sql|py|js|ts|tsx|jsx|html|css|scss|sass|java|c|cpp|h|hpp|go|rs|rb|php|sh|bat|ps1|rtf)$/i.test(extension)) {
                    if (!this.isProbablyText(buffer)) {
                        throw new Error('File appears to be binary and cannot be parsed as text');
                    }

                    return buffer.toString('utf-8');
                }

                throw new Error('Unsupported file type');
        }
    }

    chunkText(text: string): string[] {
        const chunks: string[] = [];
        const words = text.split(/\s+/);
        const step = Math.max(1, this.chunkSize - this.chunkOverlap);

        for (let i = 0; i < words.length; i += step) {
            const chunk = words.slice(i, i + this.chunkSize).join(' ');
            if (chunk.trim().length > 0) {
                chunks.push(chunk.trim());
            }
        }

        return chunks;
    }

    async saveDocument(
        userId: string,
        name: string,
        fileType: string,
        fileSize: number,
        fullText: string,
        filePath?: string
    ): Promise<string> {
        const documentId = uuidv4();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Store file path for PDFs so we can serve them directly
            const filePathToStore = fileType === 'application/pdf' ? filePath : null;

            await client.query(
                `INSERT INTO documents (id, user_id, name, file_type, file_size, full_text, file_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [documentId, userId, name, fileType, fileSize, fullText, filePathToStore]
            );

            const chunks = this.chunkText(fullText);

            for (let i = 0; i < chunks.length; i++) {
                const chunkId = uuidv4();
                const embedding = await embeddingService.generateEmbedding(chunks[i]);

                await client.query(
                    `INSERT INTO chunks (id, document_id, chunk_index, text, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
                    [chunkId, documentId, i, chunks[i], JSON.stringify(embedding)]
                );

            }

            await client.query('COMMIT');
            return documentId;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getDocument(documentId: string) {
        const result = await pool.query(
            'SELECT * FROM documents WHERE id = $1',
            [documentId]
        );
        return result.rows[0];
    }

    async getUserDocuments(userId: string) {
        const result = await pool.query(
            `SELECT id, name, file_type, file_size, created_at, updated_at 
       FROM documents 
       WHERE user_id = $1 
       ORDER BY updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    async deleteDocument(documentId: string) {
        await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);
    }
}

export const documentService = new DocumentService();
