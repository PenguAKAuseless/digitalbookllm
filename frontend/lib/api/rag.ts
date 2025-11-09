const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export interface QueryRequest {
    query: string;
    documentId: string;
    selectedText?: string;
    topK?: number;
    userId?: string;
}

export interface QueryResponse {
    response: string;
    retrievedChunks: Array<{
        text: string;
        similarity: number;
    }>;
    messageId: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    selected_text?: string;
    created_at: string;
}

export interface QueryCount {
    used: number;
    limit: number;
}

class RAGAPI {
    async query(request: QueryRequest): Promise<QueryResponse> {
        const payload = {
            ...request,
            userId: request.userId || 'guest',
        };

        const response = await fetch(`${API_BASE_URL}/rag/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Query failed');
        }

        return result.data;
    }

    async getChatHistory(documentId: string, userId: string = 'guest'): Promise<ChatMessage[]> {
        const response = await fetch(`${API_BASE_URL}/rag/history/${documentId}?userId=${userId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch chat history');
        }

        return result.data;
    }

    async getQueryCount(userId: string = 'guest'): Promise<QueryCount> {
        const response = await fetch(`${API_BASE_URL}/rag/query-count?userId=${userId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch query count');
        }

        return result.data;
    }
}

export const ragAPI = new RAGAPI();
