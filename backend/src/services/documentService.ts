import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';
import { embeddingService } from './embeddingService';
import * as fs from 'fs';
import * as path from 'path';

export class DocumentService {
    private chunkSize = parseInt(process.env.CHUNK_SIZE || '500');
    private chunkOverlap = parseInt(process.env.CHUNK_OVERLAP || '50');
    private uploadsBase = process.env.UPLOAD_DIR || './uploads';

    private isProbablyText(buffer: Buffer): boolean {
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
            if (pdfData.text?.trim()) return pdfData.text;
            throw new Error('PDF has no extractable text. Scanned PDFs require OCR.');
        }

        if (isDocx) {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }

        const textMimes = new Set([
            'text/plain', 'text/markdown', 'application/json', 'application/xml',
            'application/x-yaml', 'application/yaml', 'application/javascript',
            'application/x-javascript', 'application/typescript',
        ]);

        if (textMimes.has(normalizedType) || normalizedType.startsWith('text/') ||
            /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|log|ini|cfg|conf|sql|py|js|ts|tsx|jsx|html|css|scss|sass|java|c|cpp|h|hpp|go|rs|rb|php|sh|bat|ps1|rtf)$/i.test(extension)) {
            if (!this.isProbablyText(buffer)) {
                throw new Error('File appears to be binary and cannot be parsed as text');
            }
            return buffer.toString('utf-8');
        }

        throw new Error('Unsupported file type');
    }

    chunkText(text: string): string[] {
        const chunks: string[] = [];
        const words = text.split(/\s+/);
        const step = Math.max(1, this.chunkSize - this.chunkOverlap);

        for (let i = 0; i < words.length; i += step) {
            const chunk = words.slice(i, i + this.chunkSize).join(' ');
            if (chunk.trim().length > 0) chunks.push(chunk.trim());
        }
        return chunks;
    }

    async saveDocument(
        userId: string,
        workspaceId: string,
        name: string,
        fileType: string,
        fileSize: number,
        fullText: string,
        tempFilePath?: string
    ): Promise<string> {
        const documentId = uuidv4();
        const client = await pool.connect();

        let finalFilePath: string | null = null;

        if (fileType === 'application/pdf' && tempFilePath) {
            const wsDir = path.join(this.uploadsBase, workspaceId);
            fs.mkdirSync(wsDir, { recursive: true });
            finalFilePath = path.join(wsDir, `${documentId}.pdf`);
            fs.renameSync(tempFilePath, finalFilePath);
        }

        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO documents (id, workspace_id, user_id, name, file_type, file_size, full_text, file_path)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [documentId, workspaceId, userId, name, fileType, fileSize, fullText, finalFilePath]
            );

            const chunks = this.chunkText(fullText);
            for (let i = 0; i < chunks.length; i++) {
                const embedding = await embeddingService.generateEmbedding(chunks[i]);
                await client.query(
                    `INSERT INTO chunks (id, document_id, chunk_index, text, embedding)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [uuidv4(), documentId, i, chunks[i], JSON.stringify(embedding)]
                );
            }

            await pool.query(
                `UPDATE workspaces SET updated_at = NOW() WHERE id = $1`,
                [workspaceId]
            );

            await client.query('COMMIT');
            return documentId;
        } catch (error) {
            await client.query('ROLLBACK');
            if (finalFilePath && fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath);
            throw error;
        } finally {
            client.release();
        }
    }

    async getDocument(documentId: string, userId: string) {
        const result = await pool.query(
            `SELECT d.*, w.user_id AS workspace_owner
             FROM documents d
             JOIN workspaces w ON w.id = d.workspace_id
             WHERE d.id = $1 AND d.user_id = $2`,
            [documentId, userId]
        );
        return result.rows[0];
    }

    async getWorkspaceDocuments(workspaceId: string, userId: string) {
        const result = await pool.query(
            `SELECT d.id, d.name, d.file_type, d.file_size, d.created_at, d.updated_at
             FROM documents d
             JOIN workspaces w ON w.id = d.workspace_id
             WHERE d.workspace_id = $1 AND w.user_id = $2
             ORDER BY d.updated_at DESC`,
            [workspaceId, userId]
        );
        return result.rows;
    }

    async deleteDocument(documentId: string, userId: string): Promise<boolean> {
        const doc = await this.getDocument(documentId, userId);
        if (!doc) return false;

        if (doc.file_path && fs.existsSync(doc.file_path)) {
            fs.unlinkSync(doc.file_path);
        }

        await pool.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [documentId, userId]);
        return true;
    }
}

export const documentService = new DocumentService();
