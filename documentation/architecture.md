# Architecture

## System Overview

DigitalBookLLM uses a two-tier application architecture.

- Frontend: Next.js application for upload, reading, chat, and TTS playback
- Backend: Express API for document ingestion, chunking, embedding, retrieval, and chat persistence
- Database: PostgreSQL with pgvector for semantic search

## Request Flow

1. User uploads a document in the frontend.
2. Backend extracts text and splits it into chunks.
3. Embedding service generates vectors for each chunk.
4. Chunks and embeddings are stored in PostgreSQL.
5. User asks a question with optional selected text.
6. Backend retrieves top matching chunks from pgvector.
7. Backend builds prioritized prompt and returns assistant response.
8. Chat history and usage counters are persisted.

## Core Data Model

- users
- user_sessions
- documents
- chunks
- chat_messages

## Reliability Notes

- Database schema creation is migration-based and idempotent.
- Document records cascade delete to chunk and chat rows.
- Query volume is constrained with per-user daily limits.
