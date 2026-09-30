import { API_BASE, apiRequest } from './http';

export interface GraphNode {
    id: string;
    name: string;
    type: string;
    description: string | null;
}

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    relation_type: string;
    source_document_id: string | null;
    source_document_title: string | null;
}

export interface EntityDetail {
    entity: GraphNode;
    neighbors: Array<{
        id: string;
        name: string;
        type: string;
        relation_type: string;
        excerpt: string | null;
        source_document_id: string | null;
        source_document_title: string | null;
    }>;
}

export type ExtractionJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'DEAD';

export interface ExtractionStatus {
    job: { status: ExtractionJobStatus; error: string | null; attempts: number; updated_at: string } | null;
    documentStatus: string;
    relationCount: number;
}

class GraphAPI {
    /** Pass a document id to get only the part of the graph extracted from that document. */
    async getGraph(documentId?: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
        const query = documentId ? `?documentId=${encodeURIComponent(documentId)}` : '';
        return apiRequest(`${API_BASE}/graph${query}`);
    }

    async getExtractionStatus(documentId: string): Promise<ExtractionStatus> {
        return apiRequest(`${API_BASE}/graph/documents/${documentId}/extraction`);
    }

    async requestExtraction(documentId: string): Promise<{ result: 'queued' | 'already_queued' }> {
        return apiRequest(`${API_BASE}/graph/documents/${documentId}/extraction`, { method: 'POST' });
    }

    async getEntity(entityId: string): Promise<EntityDetail> {
        return apiRequest(`${API_BASE}/graph/${entityId}`);
    }
}

export const graphAPI = new GraphAPI();
