import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/config';

export interface Workspace {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: Date;
    updated_at: Date;
    document_count?: number;
}

class WorkspaceService {
    async getWorkspaces(userId: string): Promise<Workspace[]> {
        const result = await pool.query(
            `SELECT w.id, w.user_id, w.name, w.description, w.created_at, w.updated_at,
                    COUNT(d.id)::int AS document_count
             FROM workspaces w
             LEFT JOIN documents d ON d.workspace_id = w.id
             WHERE w.user_id = $1
             GROUP BY w.id
             ORDER BY w.updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    async getWorkspace(workspaceId: string, userId: string): Promise<Workspace | null> {
        const result = await pool.query(
            `SELECT w.id, w.user_id, w.name, w.description, w.created_at, w.updated_at,
                    COUNT(d.id)::int AS document_count
             FROM workspaces w
             LEFT JOIN documents d ON d.workspace_id = w.id
             WHERE w.id = $1 AND w.user_id = $2
             GROUP BY w.id`,
            [workspaceId, userId]
        );
        return result.rows[0] ?? null;
    }

    async createWorkspace(userId: string, name: string, description?: string): Promise<Workspace> {
        const id = uuidv4();
        const result = await pool.query(
            `INSERT INTO workspaces (id, user_id, name, description)
             VALUES ($1, $2, $3, $4)
             RETURNING id, user_id, name, description, created_at, updated_at`,
            [id, userId, name.trim(), description?.trim() || null]
        );

        return { ...result.rows[0], document_count: 0 };
    }

    async updateWorkspace(workspaceId: string, userId: string, name: string, description?: string): Promise<Workspace | null> {
        const result = await pool.query(
            `UPDATE workspaces
             SET name = $1, description = $2, updated_at = NOW()
             WHERE id = $3 AND user_id = $4
             RETURNING id, user_id, name, description, created_at, updated_at`,
            [name.trim(), description?.trim() || null, workspaceId, userId]
        );
        if (result.rows.length === 0) return null;

        const docCount = await pool.query('SELECT COUNT(*)::int AS cnt FROM documents WHERE workspace_id = $1', [workspaceId]);
        return { ...result.rows[0], document_count: docCount.rows[0].cnt };
    }

    async deleteWorkspace(workspaceId: string, userId: string): Promise<boolean> {
        const result = await pool.query(
            'DELETE FROM workspaces WHERE id = $1 AND user_id = $2 RETURNING id',
            [workspaceId, userId]
        );
        return result.rows.length > 0;
    }

    async assertOwnership(workspaceId: string, userId: string): Promise<void> {
        const result = await pool.query(
            'SELECT id FROM workspaces WHERE id = $1 AND user_id = $2',
            [workspaceId, userId]
        );
        if (result.rows.length === 0) {
            throw Object.assign(new Error('Workspace not found'), { status: 404 });
        }
    }
}

export const workspaceService = new WorkspaceService();
