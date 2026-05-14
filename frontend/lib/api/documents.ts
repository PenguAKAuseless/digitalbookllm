const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const TIMEOUT = 30000;

export interface Document {
    id: string;
    name: string;
    file_type: string;
    file_size: number;
    created_at: string;
    updated_at: string;
}

export interface DocumentDetail extends Document {
    workspace_id: string;
    user_id: string;
    full_text: string;
    file_path: string | null;
}

export interface UploadResponse {
    documentId: string;
    name: string;
    fileType: string;
    fileSize: number;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (!(init?.body instanceof FormData)) headers['Content-Type'] = 'application/json';

        const res = await fetch(url, { ...init, headers, signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
        return json.data as T;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('Upload timed out');
        if (err instanceof TypeError) throw new Error('Cannot reach backend. Make sure it is running on port 3001.');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

class DocumentAPI {
    async upload(file: File, workspaceId: string): Promise<UploadResponse> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('workspaceId', workspaceId);
        return apiRequest(`${API_BASE}/documents/upload`, { method: 'POST', body: formData });
    }

    async getDocuments(workspaceId: string): Promise<Document[]> {
        return apiRequest(`${API_BASE}/documents?workspaceId=${encodeURIComponent(workspaceId)}`);
    }

    async getDocument(documentId: string): Promise<DocumentDetail> {
        return apiRequest(`${API_BASE}/documents/${documentId}`);
    }

    async deleteDocument(documentId: string): Promise<void> {
        await apiRequest(`${API_BASE}/documents/${documentId}`, { method: 'DELETE' });
    }

    getPdfUrl(documentId: string): string {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
        return `${API_BASE}/documents/${documentId}/pdf`;
    }
}

export const documentAPI = new DocumentAPI();
