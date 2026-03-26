# Implementation Status

## Completed Modules

- Backend API for document management and prioritized RAG
- PostgreSQL schema with pgvector and retrieval indexes
- Frontend document viewer, sidebar upload flow, and chat panel
- Browser text-to-speech controls for assistant responses
- Local fine-tuning pipeline scaffold in documentation

## Backend Changes

- Added RAG request validation for query and document ID.
- Hardened chunking logic against invalid overlap settings.
- Standardized runtime and migration logging.

## Frontend Changes

- Added assistant message actions: copy, read aloud, stop audio.
- Updated app metadata and frontend package naming.
- Removed unused imports and dead UI actions in touched modules.

## Documentation Changes

- Moved non-README root docs into documentation.
- Simplified setup, architecture, and implementation docs.
- Added fine-tune pipeline docs and runnable scripts.
