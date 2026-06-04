-- ============================================================================
-- DigitalBookLLM Database Schema
-- Complete initialization script for PostgreSQL with pgvector
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For fuzzy text search

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to reset daily query count (can be called by cron or application)
CREATE OR REPLACE FUNCTION reset_daily_query_counts()
RETURNS void AS $$
BEGIN
    UPDATE user_sessions
    SET queries_today = 0, last_reset_date = CURRENT_DATE
    WHERE last_reset_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users table with password auth
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    domain VARCHAR(100),  -- For LoRA adapter routing: 'medical', 'legal', 'technical', etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Documents table (workspace-scoped)
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(255) PRIMARY KEY,
    workspace_id VARCHAR(255) REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    file_type VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    full_text TEXT NOT NULL,
    file_path VARCHAR(1000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chunks table with vector embeddings
CREATE TABLE IF NOT EXISTS chunks (
    id VARCHAR(255) PRIMARY KEY,
    document_id VARCHAR(255) REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, chunk_index)
);

-- ============================================================================
-- CHAT TABLES
-- ============================================================================

-- Chat sessions (per-document or per-workspace)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id VARCHAR(255) PRIMARY KEY,
    workspace_id VARCHAR(255) REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id VARCHAR(255) REFERENCES documents(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(255) PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    selected_text TEXT,
    retrieved_chunks TEXT[],
    source VARCHAR(20),
    source_document_name VARCHAR(500),
    provider VARCHAR(50),
    reasoning_trace JSONB,  -- Store ReAct reasoning steps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User sessions for rate limiting
CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    queries_today INTEGER DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE
);

-- ============================================================================
-- ADVANCED FEATURES TABLES
-- ============================================================================

-- Glossary Terms table for dynamic term definitions (NER-extracted)
CREATE TABLE IF NOT EXISTS glossary_terms (
    id VARCHAR(255) PRIMARY KEY,
    workspace_id VARCHAR(255) REFERENCES workspaces(id) ON DELETE CASCADE,
    term VARCHAR(500) NOT NULL,
    definition TEXT NOT NULL,
    category VARCHAR(100),  -- e.g., 'medical', 'technical', 'acronym'
    source_document_id VARCHAR(255),
    frequency INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(workspace_id, term)
);

-- Knowledge Triplets table for Graph RAG (Subject, Relation, Object)
CREATE TABLE IF NOT EXISTS knowledge_triplets (
    id VARCHAR(255) PRIMARY KEY,
    workspace_id VARCHAR(255) REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    relation VARCHAR(255) NOT NULL,
    object VARCHAR(500) NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    source_chunk_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quiz Questions table for study mode
CREATE TABLE IF NOT EXISTS quiz_questions (
    id VARCHAR(255) PRIMARY KEY,
    workspace_id VARCHAR(255) NOT NULL,
    document_id VARCHAR(255) REFERENCES documents(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    question_type VARCHAR(50) NOT NULL CHECK (question_type IN ('multiple_choice', 'true_false', 'short_answer')),
    options JSONB,  -- For multiple choice: ["A) ...", "B) ...", ...]
    correct_answer TEXT NOT NULL,
    explanation TEXT,
    difficulty VARCHAR(20) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    source_chunk_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Vector similarity index (HNSW for better performance on large datasets)
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Foreign key indexes
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id);
CREATE INDEX IF NOT EXISTS documents_workspace_id_idx ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);
CREATE INDEX IF NOT EXISTS chat_sessions_workspace_id_idx ON chat_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS chat_sessions_document_id_idx ON chat_sessions(document_id);
CREATE INDEX IF NOT EXISTS chat_sessions_user_id_idx ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS workspaces_user_id_idx ON workspaces(user_id);

-- Glossary indexes
CREATE INDEX IF NOT EXISTS glossary_terms_workspace_id_idx ON glossary_terms(workspace_id);
CREATE INDEX IF NOT EXISTS glossary_terms_term_idx ON glossary_terms(term);
CREATE INDEX IF NOT EXISTS glossary_terms_term_trgm_idx ON glossary_terms USING gin (term gin_trgm_ops);

-- Knowledge graph indexes
CREATE INDEX IF NOT EXISTS knowledge_triplets_workspace_id_idx ON knowledge_triplets(workspace_id);
CREATE INDEX IF NOT EXISTS knowledge_triplets_document_id_idx ON knowledge_triplets(document_id);
CREATE INDEX IF NOT EXISTS knowledge_triplets_subject_idx ON knowledge_triplets(subject);
CREATE INDEX IF NOT EXISTS knowledge_triplets_object_idx ON knowledge_triplets(object);
CREATE INDEX IF NOT EXISTS knowledge_triplets_subject_trgm_idx ON knowledge_triplets USING gin (subject gin_trgm_ops);

-- Quiz indexes
CREATE INDEX IF NOT EXISTS quiz_questions_document_id_idx ON quiz_questions(document_id);
CREATE INDEX IF NOT EXISTS quiz_questions_workspace_id_idx ON quiz_questions(workspace_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at for workspaces
DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
CREATE TRIGGER update_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for documents
DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for chat_sessions
DROP TRIGGER IF EXISTS update_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER update_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for glossary_terms
DROP TRIGGER IF EXISTS update_glossary_terms_updated_at ON glossary_terms;
CREATE TRIGGER update_glossary_terms_updated_at
    BEFORE UPDATE ON glossary_terms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS (for common queries)
-- ============================================================================

-- View: Workspace with document count
CREATE OR REPLACE VIEW workspace_summary AS
SELECT
    w.id,
    w.user_id,
    w.name,
    w.description,
    w.domain,
    w.created_at,
    w.updated_at,
    COUNT(DISTINCT d.id) AS document_count,
    COUNT(DISTINCT c.id) AS chunk_count,
    COUNT(DISTINCT gt.id) AS glossary_term_count,
    COUNT(DISTINCT kt.id) AS triplet_count
FROM workspaces w
LEFT JOIN documents d ON d.workspace_id = w.id
LEFT JOIN chunks c ON c.document_id = d.id
LEFT JOIN glossary_terms gt ON gt.workspace_id = w.id
LEFT JOIN knowledge_triplets kt ON kt.workspace_id = w.id
GROUP BY w.id;

-- View: Document with chunk count
CREATE OR REPLACE VIEW document_summary AS
SELECT
    d.id,
    d.workspace_id,
    d.user_id,
    d.name,
    d.file_type,
    d.file_size,
    d.created_at,
    d.updated_at,
    COUNT(DISTINCT c.id) AS chunk_count,
    COUNT(DISTINCT q.id) AS quiz_question_count
FROM documents d
LEFT JOIN chunks c ON c.document_id = d.id
LEFT JOIN quiz_questions q ON q.document_id = d.id
GROUP BY d.id;

-- ============================================================================
-- INITIAL CONFIGURATION
-- ============================================================================

-- Ensure proper settings for vector operations
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET max_parallel_maintenance_workers = 4;

-- Note: Run SELECT pg_reload_conf(); after initial setup if needed
