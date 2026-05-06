import { pool } from '../db/config';
import { v4 as uuidv4 } from 'uuid';
import { RetrievedChunk } from '../types';

interface ChatExchange {
    documentId: string;
    userId: string;
    query: string;
    response: string;
    selectedText?: string;
    retrievedChunks: RetrievedChunk[];
}

export class RAGService {
    async recordChatExchange({
        documentId,
        userId,
        query,
        response,
        selectedText,
        retrievedChunks
    }: ChatExchange): Promise<string> {
        const messageId = uuidv4();
        await pool.query(
            `INSERT INTO chat_messages (id, document_id, user_id, role, content, selected_text, retrieved_chunks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [messageId, documentId, userId, 'user', query, selectedText, null]
        );

        const assistantMessageId = uuidv4();
        const chunkIds = retrievedChunks.map((chunk) => chunk.id);

        await pool.query(
            `INSERT INTO chat_messages (id, document_id, user_id, role, content, selected_text, retrieved_chunks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [assistantMessageId, documentId, userId, 'assistant', response, null, chunkIds]
        );

        return assistantMessageId;
    }

    async getChatHistory(documentId: string, userId: string) {
        const result = await pool.query(
            `SELECT id, role, content, selected_text, created_at
       FROM chat_messages
       WHERE document_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
            [documentId, userId]
        );
        return result.rows;
    }

    async checkRateLimit(userId: string): Promise<boolean> {
        const maxQueries = parseInt(process.env.MAX_QUERIES_PER_DAY || '50');

        await pool.query(
            `UPDATE user_sessions
       SET queries_today = 0, last_reset_date = CURRENT_DATE
       WHERE id = $1 AND last_reset_date < CURRENT_DATE`,
            [userId]
        );

        const result = await pool.query(
            'SELECT queries_today FROM user_sessions WHERE id = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            await pool.query(
                `INSERT INTO user_sessions (id, queries_today, last_reset_date)
         VALUES ($1, 0, CURRENT_DATE)`,
                [userId]
            );
            return true;
        }

        return result.rows[0].queries_today < maxQueries;
    }

    async getQueryCount(userId: string): Promise<{ used: number; limit: number }> {
        const maxQueries = parseInt(process.env.MAX_QUERIES_PER_DAY || '50');

        const result = await pool.query(
            'SELECT queries_today FROM user_sessions WHERE id = $1',
            [userId]
        );

        const used = result.rows.length > 0 ? result.rows[0].queries_today : 0;
        return { used, limit: maxQueries };
    }

    async incrementQueryCount(userId: string) {
        await pool.query(
            `UPDATE user_sessions
       SET queries_today = queries_today + 1
       WHERE id = $1`,
            [userId]
        );
    }
}

export const ragService = new RAGService();
