const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const REQUEST_TIMEOUT_MS = 10000;

export interface Document {
    id: string;
    name: string;
    file_type: string;
    file_size: number;
    created_at: string;
    updated_at: string;
}

export interface UploadResponse {
    documentId: string;
    name: string;
    fileType: string;
    fileSize: number;
    message: string;
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

class DocumentAPI {
    async upload(file: File, userId: string = 'guest'): Promise<UploadResponse> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', userId);

        return apiRequest<UploadResponse>(`${API_BASE_URL}/documents/upload`, {
            method: 'POST',
            body: formData,
        });
    }

    async getDocuments(userId: string = 'guest'): Promise<Document[]> {
        return apiRequest<Document[]>(`${API_BASE_URL}/documents?userId=${encodeURIComponent(userId)}`);
    }

    async getDocument(documentId: string): Promise<Document & { full_text: string }> {
        return apiRequest<Document & { full_text: string }>(`${API_BASE_URL}/documents/${documentId}`);
    }

    async deleteDocument(documentId: string): Promise<void> {
        await apiRequest<unknown>(`${API_BASE_URL}/documents/${documentId}`, {
            method: 'DELETE',
        });
    }
}

export const documentAPI = new DocumentAPI();
