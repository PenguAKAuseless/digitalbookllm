import { API_BASE, apiRequest } from './http';

export type HighlightType = 'HIGHLIGHT' | 'BOOKMARK';

export interface LocationMeta {
    page: number;
    rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface Highlight {
    id: string;
    document_id: string;
    type: HighlightType;
    content: string | null;
    note: string | null;
    color: string;
    location_meta: LocationMeta;
    created_at: string;
    updated_at: string;
}

export interface CreateHighlightInput {
    type: HighlightType;
    content?: string;
    note?: string;
    color?: string;
    locationMeta: LocationMeta;
}

class HighlightAPI {
    async list(documentId: string): Promise<Highlight[]> {
        return apiRequest(`${API_BASE}/documents/${documentId}/highlights`);
    }

    async create(documentId: string, input: CreateHighlightInput): Promise<Highlight> {
        return apiRequest(`${API_BASE}/documents/${documentId}/highlights`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
    }

    async update(documentId: string, id: string, patch: { note?: string; color?: string }): Promise<Highlight> {
        return apiRequest(`${API_BASE}/documents/${documentId}/highlights/${id}`, {
            method: 'PUT',
            body: JSON.stringify(patch),
        });
    }

    async remove(documentId: string, id: string): Promise<void> {
        await apiRequest(`${API_BASE}/documents/${documentId}/highlights/${id}`, { method: 'DELETE' });
    }
}

export const highlightAPI = new HighlightAPI();
