const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const REQUEST_TIMEOUT_MS = 15000;

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

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Request failed');
        }

        return result.data as T;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Request timed out. Backend may be unavailable.');
        }

        if (error instanceof TypeError) {
            throw new Error('Failed to reach backend API. Ensure backend is running on port 3001.');
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

class RAGAPI {
    async query(request: QueryRequest): Promise<QueryResponse> {
        const payload = {
            ...request,
            userId: request.userId || 'guest',
        };

        return apiRequest<QueryResponse>(`${API_BASE_URL}/rag/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    }

    async getChatHistory(documentId: string, userId: string = 'guest'): Promise<ChatMessage[]> {
        return apiRequest<ChatMessage[]>(`${API_BASE_URL}/rag/history/${documentId}?userId=${encodeURIComponent(userId)}`);
    }

    async getQueryCount(userId: string = 'guest'): Promise<QueryCount> {
        return apiRequest<QueryCount>(`${API_BASE_URL}/rag/query-count?userId=${encodeURIComponent(userId)}`);
    }
}

export const ragAPI = new RAGAPI();
