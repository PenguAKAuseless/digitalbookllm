export interface Document {
    id: string;
    user_id: string;
    name: string;
    file_type: string;
    file_size: number;
    full_text: string;
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

export interface ChatMessage {
    id: string;
    document_id: string;
    user_id: string;
    role: 'user' | 'assistant';
    content: string;
    selected_text?: string;
    retrieved_chunks?: string[];
    created_at: Date;
}

export interface QueryRequest {
    query: string;
    documentId: string;
    selectedText?: string;
    topK?: number;
}

export interface QueryResponse {
    response: string;
    retrievedChunks: Array<{
        text: string;
        similarity: number;
    }>;
    messageId: string;
}

export interface UserSession {
    id: string;
    queries_today: number;
    last_reset_date: Date;
}
