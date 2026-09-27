export interface User {
    id: string;
    email: string;
    created_at: Date;
}

export interface Workspace {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: Date;
    updated_at: Date;
    document_count?: number;
}

export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface Document {
    id: string;
    workspace_id: string;
    user_id: string;
    title: string;
    author: string | null;
    file_type: string;
    file_size: number;
    storage_key: string;
    cover_key: string | null;
    page_count: number | null;
    full_text: string | null;
    status: DocumentStatus;
    status_detail: string | null;
    ocr_used: boolean;
    last_read_page: number;
    created_at: Date;
    updated_at: Date;
}

export interface Chunk {
    id: string;
    document_id: string;
    user_id: string;
    chunk_index: number;
    page_number: number | null;
    text: string;
    embedding: number[];
    created_at: Date;
}

export interface RetrievedChunk {
    id: string;
    text: string;
    page_number: number | null;
    similarity: number;
}

export interface Citation {
    chunkId: string;
    documentId: string;
    documentName?: string;
    page: number | null;
    text: string;
    similarity: number;
}

export interface ChatSession {
    id: string;
    workspace_id: string;
    document_id: string | null;
    user_id: string;
    title: string;
    created_at: Date;
    updated_at: Date;
}

export interface ChatMessage {
    id: string;
    session_id: string;
    role: 'user' | 'assistant';
    content: string;
    selected_text?: string;
    citations?: Citation[];
    provider?: string;
    created_at: Date;
}

export type HighlightType = 'HIGHLIGHT' | 'BOOKMARK';

export interface Highlight {
    id: string;
    document_id: string;
    user_id: string;
    type: HighlightType;
    content: string | null;
    note: string | null;
    color: string;
    location_meta: { page: number; rects: Array<{ x: number; y: number; width: number; height: number }> };
    created_at: Date;
    updated_at: Date;
}

export interface GraphEntity {
    id: string;
    user_id: string;
    name: string;
    type: string;
    description: string | null;
    created_at: Date;
}

export interface GraphRelation {
    id: string;
    user_id: string;
    source_entity_id: string;
    target_entity_id: string;
    relation_type: string;
    source_document_id: string | null;
    excerpt: string | null;
    created_at: Date;
}
