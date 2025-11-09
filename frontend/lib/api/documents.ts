const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

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

class DocumentAPI {
    async upload(file: File, userId: string = 'guest'): Promise<UploadResponse> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('userId', userId);

        const response = await fetch(`${API_BASE_URL}/documents/upload`, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Upload failed');
        }

        return result.data;
    }

    async getDocuments(userId: string = 'guest'): Promise<Document[]> {
        const response = await fetch(`${API_BASE_URL}/documents?userId=${userId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch documents');
        }

        return result.data;
    }

    async getDocument(documentId: string): Promise<Document & { full_text: string }> {
        const response = await fetch(`${API_BASE_URL}/documents/${documentId}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to fetch document');
        }

        return result.data;
    }

    async deleteDocument(documentId: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
            method: 'DELETE',
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to delete document');
        }
    }
}

export const documentAPI = new DocumentAPI();
