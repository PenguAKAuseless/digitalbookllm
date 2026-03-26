import { pool } from '../db/config';
import { embeddingService } from './embeddingService';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { QueryRequest, QueryResponse } from '../types';

export class RAGService {
    private togetherApiKey = process.env.TOGETHER_API_KEY || '';
    private togetherApiUrl = process.env.TOGETHER_API_URL || 'https://api.together.xyz/v1/chat/completions';
    private togetherModel = process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

    async retrieveRelevantChunks(
        documentId: string,
        queryEmbedding: number[],
        topK: number = 3,
        selectedText?: string
    ): Promise<Array<{ id: string; text: string; similarity: number }>> {
        // Search for similar chunks using cosine similarity
        const result = await pool.query(
            `SELECT id, text, 
              1 - (embedding <=> $1::vector) as similarity
       FROM chunks
       WHERE document_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
            [JSON.stringify(queryEmbedding), documentId, topK]
        );

        let chunks = result.rows;

        // De-duplicate: Remove chunks that are identical or very similar to selected_text
        if (selectedText) {
            chunks = chunks.filter((chunk: any) => {
                const similarity = this.textSimilarity(chunk.text, selectedText);
                return similarity < 0.9; // Keep only if less than 90% similar
            });
        }

        return chunks;
    }

    private textSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));

        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        if (union.size === 0) {
            return 0;
        }

        return intersection.size / union.size;
    }

    async generateResponse(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: Array<{ text: string; similarity: number }>
    ): Promise<string> {
        // Construct prioritized RAG prompt
        let prompt = `You are an AI study assistant helping a student understand their document. Answer the question based STRICTLY on the provided context.

**PRIMARY CONTEXT (Selected by user - highest priority):**
${selectedText || 'None'}

**AUGMENTED CONTEXT (Related information from document):**
`;

        retrievedChunks.forEach((chunk, idx) => {
            prompt += `\n[${idx + 1}] ${chunk.text}\n`;
        });

        prompt += `\n**QUESTION:** ${query}

**INSTRUCTIONS:**
1. Answer primarily based on the PRIMARY CONTEXT if provided
2. Use AUGMENTED CONTEXT to provide additional relevant details
3. If the answer is not in the context, say "I cannot find this information in the provided document section"
4. Be concise, clear, and educational
5. Use examples from the context when helpful

**ANSWER:**`;

        try {
            // Call Together AI API (or fallback to mock for development)
            if (this.togetherApiKey && this.togetherApiKey !== 'your_together_api_key_here') {
                const response = await axios.post(
                    this.togetherApiUrl,
                    {
                        model: this.togetherModel,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a helpful, accurate, and educational AI assistant that provides clear explanations based on document context.'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 500,
                        top_p: 0.9,
                        stop: ['**QUESTION:', '\n\n\n']
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.togetherApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000 // 30 second timeout
                    }
                );

                return response.data.choices[0].message.content;
            } else {
                // Mock response for development
                return this.generateMockResponse(query, selectedText, retrievedChunks);
            }
        } catch (error: any) {
            console.error('Error calling Together AI API:', error.response?.data || error.message);
            return this.generateMockResponse(query, selectedText, retrievedChunks);
        }
    }

    private generateMockResponse(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: Array<{ text: string; similarity: number }>
    ): string {
        const context = selectedText || (retrievedChunks[0]?.text || '');

        return `Based on the document context, here's what I can explain:\n\n` +
            `${context.substring(0, 300)}${context.length > 300 ? '...' : ''}\n\n` +
            `This appears to relate to your question about "${query}". `;
    }

    async processQuery(
        userId: string,
        request: QueryRequest
    ): Promise<QueryResponse> {
        const { query, documentId, selectedText, topK = 3 } = request;
        const safeTopK = Number.isFinite(topK) ? Math.max(1, Math.min(10, topK)) : 3;

        // Generate embedding for query
        const queryText = selectedText ? `${query} ${selectedText}` : query;
        const queryEmbedding = await embeddingService.generateEmbedding(queryText);

        // Retrieve relevant chunks
        const retrievedChunks = await this.retrieveRelevantChunks(
            documentId,
            queryEmbedding,
            safeTopK,
            selectedText
        );

        // Generate response
        const response = await this.generateResponse(
            query,
            selectedText,
            retrievedChunks
        );

        // Save chat message
        const messageId = uuidv4();
        const chunkIds = retrievedChunks.map(c => c.id);

        await pool.query(
            `INSERT INTO chat_messages (id, document_id, user_id, role, content, selected_text, retrieved_chunks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [messageId, documentId, userId, 'user', query, selectedText, null]
        );

        const assistantMessageId = uuidv4();
        await pool.query(
            `INSERT INTO chat_messages (id, document_id, user_id, role, content, selected_text, retrieved_chunks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [assistantMessageId, documentId, userId, 'assistant', response, null, chunkIds]
        );

        // Update query count
        await this.incrementQueryCount(userId);

        return {
            response,
            retrievedChunks: retrievedChunks.map(c => ({
                text: c.text,
                similarity: c.similarity
            })),
            messageId: assistantMessageId
        };
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

        // Reset if new day
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

    private async incrementQueryCount(userId: string) {
        await pool.query(
            `UPDATE user_sessions
       SET queries_today = queries_today + 1
       WHERE id = $1`,
            [userId]
        );
    }
}

export const ragService = new RAGService();
