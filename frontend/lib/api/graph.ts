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

class GraphAPI {
    async getGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
        return apiRequest(`${API_BASE}/graph`);
    }

    async getEntity(entityId: string): Promise<EntityDetail> {
        return apiRequest(`${API_BASE}/graph/${entityId}`);
    }
}

export const graphAPI = new GraphAPI();
