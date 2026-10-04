import { API_BASE, apiRequest, resolveApiUrl } from './http';

export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface Document {
    id: string;
    title: string;
    author: string | null;
    file_type: string;
    file_size: number;
    status: DocumentStatus;
    page_count: number | null;
    cover_key: string | null;
    last_read_page: number;
    created_at: string;
    updated_at: string;
}

export interface DocumentDetail extends Document {
    workspace_id: string;
    user_id: string;
    full_text: string | null;
    ocr_used: boolean;
}

export interface UploadResponse {
    documentId: string;
    status: DocumentStatus;
}

class DocumentAPI {
    async upload(file: File, workspaceId: string): Promise<UploadResponse> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('workspaceId', workspaceId);
        return apiRequest(`${API_BASE}/documents/upload`, { method: 'POST', body: formData }, 120000);
    }

    async getDocuments(workspaceId: string): Promise<Document[]> {
        return apiRequest(`${API_BASE}/documents?workspaceId=${encodeURIComponent(workspaceId)}`);
    }

    async getDocument(documentId: string): Promise<DocumentDetail> {
        return apiRequest(`${API_BASE}/documents/${documentId}`);
    }

    /** Polled by the library grid while a document is UPLOADED/PROCESSING (UC07). */
    async getStatus(documentId: string): Promise<{ status: DocumentStatus; status_detail: string | null; ocr_used: boolean; page_count: number | null }> {
        return apiRequest(`${API_BASE}/documents/${documentId}/status`);
    }

    async getFileUrl(documentId: string): Promise<{ url: string; fileType: string }> {
        const file = await apiRequest<{ url: string; fileType: string }>(`${API_BASE}/documents/${documentId}/file`);
        return { ...file, url: resolveApiUrl(file.url) };
    }

    async getCoverUrl(documentId: string): Promise<{ url: string } | null> {
        try {
            const cover = await apiRequest<{ url: string }>(`${API_BASE}/documents/${documentId}/cover`);
            return { url: resolveApiUrl(cover.url) };
        } catch {
            return null;
        }
    }

    async updateProgress(documentId: string, page: number): Promise<void> {
        await apiRequest(`${API_BASE}/documents/${documentId}/progress`, {
            method: 'PUT',
            body: JSON.stringify({ page }),
        });
    }

    async deleteDocument(documentId: string): Promise<void> {
        await apiRequest(`${API_BASE}/documents/${documentId}`, { method: 'DELETE' });
    }
}

export const documentAPI = new DocumentAPI();
