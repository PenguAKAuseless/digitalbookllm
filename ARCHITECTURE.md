# DigitalBookLLM Architecture Diagrams

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Next.js Frontend (Port 3000)                    │  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │  │
│  │  │   Sidebar   │  │   Document   │  │   Chat Panel   │  │  │
│  │  │  Component  │  │    Viewer    │  │   Component    │  │  │
│  │  └─────┬───────┘  └──────┬───────┘  └────────┬───────┘  │  │
│  │        │                 │                    │           │  │
│  │  ┌─────▼─────────────────▼────────────────────▼───────┐  │  │
│  │  │         API Client Layer (documents, rag)          │  │  │
│  │  └────────────────────────┬───────────────────────────┘  │  │
│  └───────────────────────────┼──────────────────────────────┘  │
└────────────────────────────┼─────────────────────────────────┘
                             │
                        HTTP/JSON
                             │
┌────────────────────────────▼─────────────────────────────────┐
│              Express.js Backend (Port 3001)                   │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Middleware Layer                                      │  │
│  │  • CORS    • Helmet    • Morgan    • Rate Limit       │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  Routes Layer                                          │  │
│  │  • /api/documents/*  • /api/rag/*  • /health          │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  Controllers Layer                                     │  │
│  │  • documentController  • ragController                 │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  Services Layer                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │  Document    │  │  Embedding   │  │     RAG     │ │  │
│  │  │   Service    │  │   Service    │  │   Service   │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  └─────┬───────┘ │  │
│  └─────────┼──────────────────┼─────────────────┼────────┘  │
└────────────┼──────────────────┼─────────────────┼───────────┘
             │                  │                 │
             └──────────┬───────┴─────────────────┘
                        │
┌───────────────────────▼────────────────────────────────────┐
│              PostgreSQL Database (Port 5432)                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐│
│  │  users   │  │documents │  │   chunks   │  │   chat   ││
│  │          │  │          │  │ (vectors)  │  │ messages ││
│  └──────────┘  └──────────┘  └────────────┘  └──────────┘│
│                                                             │
│  Extension: pgvector (vector similarity search)            │
└─────────────────────────────────────────────────────────────┘

External:
┌─────────────────────┐
│  Grok API (Optional)│
│  Together API       │
│  LLM Responses      │
└─────────────────────┘
```

## Data Flow: Document Upload

```
┌───────────┐
│   User    │
│  Selects  │
│   File    │
└─────┬─────┘
      │
      ▼
┌─────────────────┐
│   Sidebar UI    │
│  File Input     │
└────────┬────────┘
         │ FormData
         ▼
┌─────────────────┐
│ documentAPI     │
│ .upload()       │
└────────┬────────┘
         │ POST /api/documents/upload
         ▼
┌─────────────────┐
│ documentRoutes  │
│ multer upload   │
└────────┬────────┘
         │ File saved to disk
         ▼
┌─────────────────────┐
│ documentController  │
│ .uploadDocument()   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ documentService     │
│ .extractText()      │
└────────┬────────────┘
         │
         ├─ PDF → pdf-parse
         ├─ DOCX → mammoth
         └─ TXT/MD → raw text
         │
         ▼
┌─────────────────────┐
│ documentService     │
│ .chunkText()        │
└────────┬────────────┘
         │ [chunk1, chunk2, chunk3...]
         ▼
┌─────────────────────┐
│ embeddingService    │
│ .generateEmbedding()│
└────────┬────────────┘
         │ [0.123, -0.456, ...] (384 dims)
         ▼
┌─────────────────────┐
│ PostgreSQL          │
│ INSERT documents    │
│ INSERT chunks       │
└────────┬────────────┘
         │ documentId
         ▼
┌─────────────────────┐
│ Response to UI      │
│ {documentId: ".."}  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Sidebar refreshes   │
│ Shows new document  │
└─────────────────────┘
```

## Data Flow: RAG Query

```
┌───────────┐
│   User    │
│  Selects  │
│   Text    │──┐
└─────┬─────┘  │
      │        │ selectedText
      │        │
      ▼        │
┌─────────────┐│
│   User      ││
│  Types      ││
│  Question   ││
└─────┬───────┘│
      │        │
      ▼        │
┌─────────────────────┐
│   Chat Panel UI     │
│  handleSendMessage()│
└────────┬────────────┘
         │ query + selectedText
         ▼
┌─────────────────┐
│    ragAPI       │
│    .query()     │
└────────┬────────┘
         │ POST /api/rag/query
         ▼
┌─────────────────┐
│   ragRoutes     │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│   ragController     │
│   .query()          │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   ragService        │
│ .checkRateLimit()   │
└────────┬────────────┘
         │ queries_today < 50?
         ▼
┌─────────────────────┐
│  embeddingService   │
│ .generateEmbedding()│
└────────┬────────────┘
         │ query_vector
         ▼
┌─────────────────────────────────────┐
│  PostgreSQL Vector Search           │
│  SELECT ... WHERE document_id = ... │
│  ORDER BY embedding <=> query_vector│
│  LIMIT 3                            │
└────────┬────────────────────────────┘
         │ [chunk1, chunk2, chunk3]
         ▼
┌─────────────────────┐
│   ragService        │
│ .deduplicateChunks()│
└────────┬────────────┘
         │ filtered chunks
         ▼
┌─────────────────────┐
│   ragService        │
│ .constructPrompt()  │
└────────┬────────────┘
         │
         │ PRIMARY: selectedText
         │ AUGMENTED: chunk1, chunk2...
         │ QUESTION: query
         │
         ▼
┌─────────────────────┐
│  Grok API / Mock    │
│  LLM Generation     │
└────────┬────────────┘
         │ AI response
         ▼
┌─────────────────────┐
│  PostgreSQL         │
│  INSERT messages    │
│  UPDATE query_count │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Response to UI     │
│  {response: "...",  │
│   messageId: "..."}│
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Chat Panel shows   │
│  AI response        │
└─────────────────────┘
```

## Component Communication

```
┌──────────────────────────────────────────────────────────┐
│                    Main Page (page.tsx)                   │
│                                                           │
│  State:                                                   │
│  • selectedDocumentId                                     │
│  • selectedText                                           │
│  • sidebarOpen                                            │
│                                                           │
│  ┌──────────┐      ┌──────────────┐      ┌────────────┐│
│  │ Sidebar  │      │   Document   │      │    Chat    ││
│  │          │      │    Viewer    │      │   Panel    ││
│  │          │      │              │      │            ││
│  │ Props:   │      │ Props:       │      │ Props:     ││
│  │ • onSelect◄─────┼──documentId  │      │documentId  ││
│  │ • selected│     │ • onTextSel.◄┼──────┼selected.. ││
│  │           │     │              │      │            ││
│  │ Emits:    │     │ Emits:       │      │ Uses:      ││
│  │ docId ────┼────►│ text ────────┼─────►│both        ││
│  └───────────┘     └──────────────┘      └────────────┘│
│                                                           │
│  Flow:                                                    │
│  1. User uploads doc → Sidebar emits docId               │
│  2. Page updates selectedDocumentId                       │
│  3. Viewer receives docId, loads document                 │
│  4. User selects text → Viewer emits text                 │
│  5. Page updates selectedText                             │
│  6. Chat receives both docId + text                       │
│  7. User asks question → Chat queries with context        │
└───────────────────────────────────────────────────────────┘
```

## Database Schema Relationships

```
┌──────────────┐
│    users     │
│──────────────│
│ id (PK)      │◄──┐
│ email        │   │
│ created_at   │   │
└──────────────┘   │
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  documents   │  │chat_messages │  │user_sessions │
│──────────────│  │──────────────│  │──────────────│
│ id (PK)      │◄─┤document_id   │  │ id (PK,FK)   │
│ user_id (FK) │  │user_id (FK)  │  │queries_today │
│ name         │  │role          │  │last_reset    │
│ file_type    │  │content       │  └──────────────┘
│ full_text    │  │selected_text │
│ created_at   │  │created_at    │
└──────┬───────┘  └──────────────┘
       │
       │
       ▼
┌──────────────┐
│    chunks    │
│──────────────│
│ id (PK)      │
│document_id FK│
│ chunk_index  │
│ text         │
│embedding(384)│◄── pgvector extension
│ created_at   │
└──────────────┘
      │
      └─── Index: ivfflat (embedding vector_cosine_ops)
           Fast similarity search: O(log n)
```

## Prioritized RAG Algorithm

```
┌─────────────────────────────────────────────────────────┐
│              RAG Query Processing Flow                   │
└─────────────────────────────────────────────────────────┘

Input:
┌──────────────┐  ┌──────────────┐
│    Query     │  │ Selected Text│
│  "Explain    │  │ "phospholipid│
│   this..."   │  │  bilayer..."  │
└──────┬───────┘  └──────┬────────┘
       │                 │
       └────────┬────────┘
                │
                ▼
┌─────────────────────────────────┐
│  Combine & Generate Embedding   │
│  "Explain this phospholipid..." │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│      Vector Search              │
│  Find top-K similar chunks      │
│  Using cosine similarity        │
└────────────┬────────────────────┘
             │
             ▼
        Retrieved:
┌─────────────────────────────────┐
│  Chunk A: "...bilayer..."       │ similarity: 0.95
│  Chunk B: "...proteins..."      │ similarity: 0.87
│  Chunk C: "...membrane..."      │ similarity: 0.82
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│      De-duplication             │
│  Remove chunks similar to       │
│  selected text (>90%)           │
└────────────┬────────────────────┘
             │
             ▼
        Filtered:
┌─────────────────────────────────┐
│  Chunk B: "...proteins..."      │
│  Chunk C: "...membrane..."      │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│    Construct Prompt             │
│                                 │
│  PRIMARY CONTEXT:               │
│    [selected text]              │
│                                 │
│  AUGMENTED CONTEXT:             │
│    [Chunk B]                    │
│    [Chunk C]                    │
│                                 │
│  QUESTION:                      │
│    [query]                      │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│       LLM Generation            │
│  (Grok API or Mock)             │
└────────────┬────────────────────┘
             │
             ▼
        Output:
┌─────────────────────────────────┐
│  "The phospholipid bilayer is   │
│   composed of two layers of     │
│   phospholipids. Based on the   │
│   selected text and related     │
│   information..."               │
└─────────────────────────────────┘
```

## Technology Stack

```
Frontend Layer
├─ Next.js 16.0.0
├─ React 19.2.0
├─ TypeScript 5.x
├─ Tailwind CSS 4.x
├─ Radix UI (components)
└─ Lucide React (icons)

Backend Layer
├─ Node.js 18+
├─ Express.js 4.18
├─ TypeScript 5.3
├─ Multer (file upload)
├─ pdf-parse (PDF extraction)
├─ mammoth (DOCX extraction)
└─ @xenova/transformers (embeddings)

Database Layer
├─ PostgreSQL 14+
├─ pgvector extension
├─ node-postgres (pg)
└─ pgvector npm package

AI/ML Layer
├─ all-MiniLM-L6-v2 (embeddings)
├─ Vector similarity (cosine)
├─ Finetune LLM (Llama 3.1 8B-Instruct and Mistral-7B-Instruct-v0.3)
└─ Together API and Grok API

Security & Middleware
├─ Helmet.js
├─ CORS
├─ express-rate-limit
└─ Morgan (logging)
```

---

*These diagrams provide a visual understanding of the DigitalBookLLM architecture, data flows, and component relationships.*
