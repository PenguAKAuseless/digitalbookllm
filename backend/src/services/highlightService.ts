import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';

export interface LocationMeta {
    page: number;
    /** Normalized bounding rectangles (0-1 range) so re-render is resolution-independent. */
    rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface CreateHighlightInput {
    documentId: string;
    userId: string;
    type: 'HIGHLIGHT' | 'BOOKMARK';
    content?: string;
    note?: string;
    color?: string;
    locationMeta: LocationMeta;
}

/** Highlights and bookmarks (UC10, UC11), tenant-isolated by user_id per FR01. */
export class HighlightService {
    async create(input: CreateHighlightInput) {
        const id = uuidv4();
        const result = await pool.query(
            `INSERT INTO highlights (id, document_id, user_id, type, content, note, color, location_meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                id,
                input.documentId,
                input.userId,
                input.type,
                input.content ?? null,
                input.note ?? null,
                input.color ?? 'yellow',
                JSON.stringify(input.locationMeta),
            ]
        );
        return result.rows[0];
    }

    async listForDocument(documentId: string, userId: string) {
        const result = await pool.query(
            `SELECT * FROM highlights WHERE document_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
            [documentId, userId]
        );
        return result.rows;
    }

    async update(id: string, userId: string, patch: { note?: string; color?: string }) {
        const result = await pool.query(
            `UPDATE highlights SET note = COALESCE($3, note), color = COALESCE($4, color), updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId, patch.note ?? null, patch.color ?? null]
        );
        return result.rows[0] ?? null;
    }

    async delete(id: string, userId: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM highlights WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
        return result.rows.length > 0;
    }
}

export const highlightService = new HighlightService();
