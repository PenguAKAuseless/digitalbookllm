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

export interface Document {
    id: string;
    workspace_id: string;
    user_id: string;
    name: string;
    file_type: string;
    file_size: number;
    full_text: string;
    file_path: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface Chunk {
    id: string;
    document_id: string;
    chunk_index: number;
    text: string;
    embedding: number[];
    created_at: Date;
}

export interface RetrievedChunk {
    id: string;
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
    retrieved_chunks?: string[];
    created_at: Date;
}

export interface QueryResponse {
    response: string;
    retrievedChunks: Array<{ text: string; similarity: number; documentName?: string }>;
    messageId: string | null;
}
