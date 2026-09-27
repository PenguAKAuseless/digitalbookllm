import { API_BASE, apiRequest, authToken } from './http';

export interface QueryRequest {
    query: string;
    workspaceId: string;
    documentId?: string;
    selectedText?: string;
    topK?: number;
    sessionId?: string;
}

export interface Citation {
    chunkId: string;
    documentId: string;
    documentName?: string;
    page: number | null;
    text: string;
    similarity: number;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    selected_text?: string;
    citations?: Citation[];
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

export interface StreamHandlers {
    onProvider?: (provider: string) => void;
    onDelta: (text: string) => void;
    onCitations?: (citations: Citation[]) => void;
    onDone: (result: { messageId: string | null; sessionId: string | null }) => void;
    onError: (message: string) => void;
}

/**
 * Consumes the SSE stream from POST /api/rag/query (NFR02.1). `fetch` (not
 * `EventSource`) is used because the endpoint requires a POST body and an
 * Authorization header, neither of which EventSource supports.
 */
export async function streamQuery(request: QueryRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_BASE}/rag/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
        },
        body: JSON.stringify(request),
        signal,
    });

    if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        handlers.onError(json.error || `Request failed (${res.status})`);
        return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const raw of events) {
            const eventLine = raw.split('\n').find((l) => l.startsWith('event:'));
            const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;

            const event = eventLine.slice(6).trim();
            const data = JSON.parse(dataLine.slice(5).trim());

            if (event === 'provider') handlers.onProvider?.(data.provider);
            else if (event === 'delta') handlers.onDelta(data.text);
            else if (event === 'citations') handlers.onCitations?.(data as Citation[]);
            else if (event === 'done') handlers.onDone(data);
            else if (event === 'error') handlers.onError(data.error);
        }
    }
}

class RAGAPI {
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
