-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table (simplified for mockup)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES users (id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    file_type VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    full_text TEXT NOT NULL,
    file_path VARCHAR(1000), -- Store file path for PDFs to serve directly
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure existing deployments with a smaller file_type column are upgraded.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'documents'
          AND column_name = 'file_type'
          AND character_maximum_length IS NOT NULL
          AND character_maximum_length < 255
    ) THEN
        ALTER TABLE documents
        ALTER COLUMN file_type TYPE VARCHAR(255);
    END IF;
END $$;

-- Chunks table with vector embeddings
CREATE TABLE IF NOT EXISTS chunks (
    id VARCHAR(255) PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents (id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding vector (384), -- 384 dimensions for all-MiniLM-L6-v2
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (document_id, chunk_index)
);

-- Convert existing fallback array embeddings to pgvector if needed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'chunks'
          AND column_name = 'embedding'
          AND data_type = 'ARRAY'
          AND udt_name = '_float8'
    ) THEN
        ALTER TABLE chunks
        ALTER COLUMN embedding TYPE vector(384)
        USING ('[' || array_to_string(embedding, ',') || ']')::vector(384);
    END IF;
END $$;

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Cleanup old fallback function if present.
DROP FUNCTION IF EXISTS cosine_similarity(DOUBLE PRECISION[], DOUBLE PRECISION[]);
-- Create index for document lookups
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(255) PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    selected_text TEXT,
    retrieved_chunks TEXT[], -- Array of chunk IDs used for context
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User session for rate limiting
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(255) PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    queries_today INTEGER DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents (user_id);

CREATE INDEX IF NOT EXISTS chat_messages_document_id_idx ON chat_messages (document_id);

CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx ON chat_messages (user_id);