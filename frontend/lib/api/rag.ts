const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const TIMEOUT = 120000;

export interface QueryRequest {
    query: string;
    workspaceId: string;
    documentId?: string;
    selectedText?: string;
    topK?: number;
    sessionId?: string;
}

export interface RetrievedChunk {
    text: string;
    similarity: number;
    documentName?: string;
}

export interface QueryResponse {
    response: string;
    retrievedChunks: RetrievedChunk[];
    messageId: string | null;
    sessionId?: string;
    source: 'document' | 'workspace' | 'none';
    sourceDocumentName?: string;
    provider?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    selected_text?: string;
    source?: 'document' | 'workspace' | 'none';
    source_document_name?: string;
    provider?: string;
    created_at: string;
}

export interface ChatSession {
    id: string;
    document_id: string | null;
    title: string;
    created_at: string;
    updated_at: string;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const headers: Record<string, string> = { ...(init?.headers as Record<string, string>), 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(url, { ...init, headers, signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
        return json.data as T;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('Request timed out');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

class RAGAPI {
    async query(request: QueryRequest): Promise<QueryResponse> {
        return apiRequest(`${API_BASE}/rag/query`, {
            method: 'POST',
            body: JSON.stringify(request),
        });
    }

    async getSessionHistory(sessionId: string): Promise<ChatMessage[]> {
        return apiRequest(`${API_BASE}/rag/history/session/${sessionId}`);
    }

    async getWorkspaceSessions(workspaceId: string): Promise<ChatSession[]> {
        return apiRequest(`${API_BASE}/rag/sessions/workspace/${workspaceId}`);
    }

    async deleteSession(sessionId: string): Promise<void> {
        await apiRequest(`${API_BASE}/rag/sessions/${sessionId}`, { method: 'DELETE' });
    }
}

export const ragAPI = new RAGAPI();
