# Architecture

## Overview

DigitalBookLLM is a document analysis platform with RAG (Retrieval-Augmented Generation). Users create workspaces, upload documents, and chat with their documents using AI.

```
frontend (Next.js) ←→ backend (Express/Node) ←→ PostgreSQL + pgvector
                                              ↕
                                         LLM Router
                              ┌──────────────────────────┐
                              │ Together AI               │
                              │ OpenAI                    │ priority
                              │ Anthropic                 │ order
                              │ Groq                      │
                              │ Ollama (local)            │
                              │ Xenova flan-t5 (local)    │
                              └──────────────────────────┘
```

## Database Schema

```
users
  └── workspaces (one-to-many)
        └── documents (one-to-many)
              └── chunks (one-to-many, with vector embeddings)
        └── chat_sessions (per-document or per-workspace)
              └── chat_messages
```

## Key Design Decisions

- **Workspace isolation**: Files stored at `uploads/{workspace_id}/{document_id}.pdf`
- **LLM Router**: Tries providers in priority order; falls back to local Xenova model — always works without API keys
- **Embeddings**: `Xenova/all-MiniLM-L6-v2` runs locally (384-dim, fast)
- **JWT auth**: Tokens stored in localStorage; 7-day expiry
- **Workspace-level RAG**: Queries pgvector across all documents in a workspace using a single SQL join

## API Routes

```
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me

GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/:id
PUT    /api/workspaces/:id
DELETE /api/workspaces/:id

GET    /api/documents?workspaceId=
POST   /api/documents/upload
GET    /api/documents/:id
GET    /api/documents/:id/pdf
DELETE /api/documents/:id

POST /api/rag/query                          # document-level
POST /api/rag/query/workspace                # workspace-level
GET  /api/rag/sessions/workspace/:workspaceId
GET  /api/rag/sessions/document/:workspaceId/:documentId
GET  /api/rag/history/session/:sessionId
DELETE /api/rag/sessions/:sessionId
GET  /api/rag/query-count
```
