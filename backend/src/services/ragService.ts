import { pool } from '../db/config';
import { v4 as uuidv4 } from 'uuid';
import { RetrievedChunk } from '../types';

interface RecordExchange {
    workspaceId: string;
    documentId?: string;
    userId: string;
    query: string;
    response: string;
    selectedText?: string;
    retrievedChunks: RetrievedChunk[];
    sessionId?: string;
    source?: 'document' | 'workspace' | 'none';
    sourceDocumentName?: string;
    provider?: string;
}

export class RAGService {
    async createSession(workspaceId: string, userId: string, documentId?: string): Promise<string> {
        const id = uuidv4();
        await pool.query(
            `INSERT INTO chat_sessions (id, workspace_id, document_id, user_id, title)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, workspaceId, documentId || null, userId, 'New Chat']
        );
        return id;
    }

    async recordChatExchange({
        workspaceId, documentId, userId, query, response, selectedText, retrievedChunks, sessionId,
        source, sourceDocumentName, provider,
    }: RecordExchange): Promise<{ messageId: string; sessionId: string }> {
        const sid = sessionId || await this.createSession(workspaceId, userId, documentId);

        // Auto-title the session from the first user query
        const existing = await pool.query(
            'SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE session_id = $1',
            [sid]
        );
        if (existing.rows[0].cnt === 0) {
            const title = query.length > 60 ? `${query.slice(0, 60).trim()}…` : query.trim();
            await pool.query('UPDATE chat_sessions SET title = $1 WHERE id = $2', [title, sid]);
        }

        await pool.query(
            `INSERT INTO chat_messages (id, session_id, role, content, selected_text)
             VALUES ($1, $2, $3, $4, $5)`,
            [uuidv4(), sid, 'user', query, selectedText || null]
        );

        const assistantId = uuidv4();
        const chunkIds = retrievedChunks.map((c) => c.id);
        await pool.query(
            `INSERT INTO chat_messages (id, session_id, role, content, retrieved_chunks, source, source_document_name, provider)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [assistantId, sid, 'assistant', response, chunkIds, source || null, sourceDocumentName || null, provider || null]
        );

        await pool.query('UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1', [sid]);
        return { messageId: assistantId, sessionId: sid };
    }

    async getSessionHistory(sessionId: string) {
        const result = await pool.query(
            `SELECT id, role, content, selected_text, source, source_document_name, provider, created_at
             FROM chat_messages
             WHERE session_id = $1
             ORDER BY created_at ASC`,
            [sessionId]
        );
        return result.rows;
    }

    async getDocumentSessions(workspaceId: string, documentId: string, userId: string) {
        const result = await pool.query(
            `SELECT id, title, created_at, updated_at
             FROM chat_sessions
             WHERE workspace_id = $1 AND document_id = $2 AND user_id = $3
             ORDER BY updated_at DESC`,
            [workspaceId, documentId, userId]
        );
        return result.rows;
    }

    async getWorkspaceSessions(workspaceId: string, userId: string) {
        const result = await pool.query(
            `SELECT id, document_id, title, created_at, updated_at
             FROM chat_sessions
             WHERE workspace_id = $1 AND user_id = $2
             ORDER BY updated_at DESC`,
            [workspaceId, userId]
        );
        return result.rows;
    }

    async deleteSession(sessionId: string, userId: string): Promise<boolean> {
        const result = await pool.query(
            'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
            [sessionId, userId]
        );
        return result.rows.length > 0;
    }

    async checkRateLimit(userId: string): Promise<boolean> {
        const maxQueries = parseInt(process.env.MAX_QUERIES_PER_DAY || '100');

        await pool.query(
            `UPDATE user_sessions SET queries_today = 0, last_reset_date = CURRENT_DATE
             WHERE id = $1 AND last_reset_date < CURRENT_DATE`,
            [userId]
        );

        const result = await pool.query(
            'SELECT queries_today FROM user_sessions WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            await pool.query(
                `INSERT INTO user_sessions (id, queries_today, last_reset_date) VALUES ($1, 0, CURRENT_DATE)
                 ON CONFLICT (id) DO NOTHING`,
                [userId]
            );
            return true;
        }

        return result.rows[0].queries_today < maxQueries;
    }

    async getQueryCount(userId: string): Promise<{ used: number; limit: number }> {
        const maxQueries = parseInt(process.env.MAX_QUERIES_PER_DAY || '100');
        const result = await pool.query('SELECT queries_today FROM user_sessions WHERE id = $1', [userId]);
        return { used: result.rows[0]?.queries_today ?? 0, limit: maxQueries };
    }

    async incrementQueryCount(userId: string) {
        await pool.query(
            'UPDATE user_sessions SET queries_today = queries_today + 1 WHERE id = $1',
            [userId]
        );
    }
}

export const ragService = new RAGService();
