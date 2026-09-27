import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';
import { storage, makeStorageKey } from '../storage';
import { enqueue } from '../queue/jobQueue';

export interface UploadResult {
    documentId: string;
    status: string;
}

export class DocumentService {
    /** Persists the raw file and creates the document row; ingestion runs async via the job queue. */
    async uploadDocument(
        userId: string,
        workspaceId: string,
        originalName: string,
        fileType: string,
        fileSize: number,
        fileBuffer: Buffer
    ): Promise<UploadResult> {
        const documentId = uuidv4();
        const storageKey = makeStorageKey(workspaceId, documentId, originalName);

        await storage().put(storageKey, fileBuffer, fileType || 'application/octet-stream');

        await pool.query(
            `INSERT INTO documents (id, workspace_id, user_id, title, file_type, file_size, storage_key, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'UPLOADED')`,
            [documentId, workspaceId, userId, originalName, fileType, fileSize, storageKey]
        );

        await enqueue('INGEST_DOCUMENT', {
            documentId,
            storageKey,
            fileType,
            fileName: originalName,
            userId,
        });

        return { documentId, status: 'UPLOADED' };
    }

    async getDocument(documentId: string, userId: string) {
        const result = await pool.query(`SELECT * FROM documents WHERE id = $1 AND user_id = $2`, [documentId, userId]);
        return result.rows[0] ?? null;
    }

    async getStatus(documentId: string, userId: string) {
        const result = await pool.query(
            `SELECT status, status_detail, ocr_used, page_count FROM documents WHERE id = $1 AND user_id = $2`,
            [documentId, userId]
        );
        return result.rows[0] ?? null;
    }

    async getWorkspaceDocuments(workspaceId: string, userId: string) {
        const result = await pool.query(
            `SELECT id, title, author, file_type, file_size, status, page_count, cover_key,
                    last_read_page, created_at, updated_at
             FROM documents
             WHERE workspace_id = $1 AND user_id = $2
             ORDER BY updated_at DESC`,
            [workspaceId, userId]
        );
        return result.rows;
    }

    async updateLastReadPage(documentId: string, userId: string, page: number): Promise<void> {
        await pool.query(
            `UPDATE documents SET last_read_page = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
            [documentId, userId, page]
        );
    }

    async deleteDocument(documentId: string, userId: string): Promise<boolean> {
        const doc = await this.getDocument(documentId, userId);
        if (!doc) return false;

        await storage().delete(doc.storage_key).catch(() => undefined);
        if (doc.cover_key) await storage().delete(doc.cover_key).catch(() => undefined);

        await pool.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [documentId, userId]);
        return true;
    }

    async assertOwnership(documentId: string, userId: string): Promise<void> {
        const result = await pool.query('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [documentId, userId]);
        if (result.rows.length === 0) {
            throw Object.assign(new Error('Document not found'), { status: 404 });
        }
    }
}

export const documentService = new DocumentService();
