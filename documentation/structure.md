# Project planned structure

```
digitalbookllm/
├── apps/                          # Deployable apps
│   ├── frontend/                  # React app (FR-02 Viewer, FR-03 Chat)
│   │   ├── public/                # Static assets (index.html, favicon)
│   │   ├── src/
│   │   │   ├── components/        # Reusable UI (ChatPanel.tsx, PDFViewer.tsx with PDF.js)
│   │   │   │   ├── common/        # Buttons, Modals (e.g., HighlightMenu)
│   │   │   │   ├── chat/          # FR-03: ChatThread, MessageBubble
│   │   │   │   ├── viewer/        # FR-02: DocumentCanvas, AnnotationLayer
│   │   │   │   └── integrations/  # FR-09: QuizletExportButton
│   │   │   ├── hooks/             # Custom (useRAGQuery.ts for FR-03)
│   │   │   ├── pages/             # Routes (Library.tsx, DocumentView.tsx)
│   │   │   ├── services/          # API calls (authService.ts, ragService.ts)
│   │   │   ├── store/             # State (Zustand/Redux: chatHistory, userProgress)
│   │   │   ├── types/             # Shared TS interfaces (QueryResponse, Chunk)
│   │   │   └── utils/             # Helpers (formatExport.ts)
│   │   ├── tests/                 # Jest/Vitest (e2e for split-screen)
│   │   ├── package.json           # Deps: react, @pdftron/webviewer (alt to PDF.js), zustand
│   │   └── tsconfig.json
│   └── backend/                   # Node.js API (FR-01 Upload, NIR-01 Processing)
│       ├── src/
│       │   ├── controllers/       # Routes (uploadController.ts, ragController.ts)
│       │   ├── middleware/        # Auth (firebase-admin), rate-limit (for 50 queries/day)
│       │   ├── models/            # DB schemas (FileMetadata, UserSession)
│       │   ├── routes/            # Express (api/v1/files, api/v1/rag/query)
│       │   ├── services/          # Business logic (ragService.ts with LangChain/Chroma)
│       │   ├── utils/             # Agentic chunking (chunker.ts), errorHandler.ts
│       │   └── config/            # Env vars, Firebase init
│       ├── tests/                 # Mocha/Jest (unit for RAG, integration for API)
│       ├── package.json           # Deps: express, langchain, chromadb, firebase-admin
│       └── tsconfig.json
├── packages/                      # Shared libs
│   ├── ui/                        # Storybook components (Button, ChatInput)
│   ├── rag-core/                  # Shared RAG (basicRAG.ts, agentRAG.ts from notebook)
│   │   ├── src/                   # Chunkers (agenticChunker.ts), retrievers
│   │   └── package.json
│   └── types/                     # Global TS defs (DocumentChunk, QueryParams)
├── tools/                         # Scripts (seedDB.ts, benchmarkRAG.ts from notebook)
├── docs/                          # Architecture diagrams (Mermaid), API specs (OpenAPI)
├── .github/workflows/             # CI/CD (lint-test-build.yml, deploy.yml)
├── turbo.json                     # Turborepo config (caching, pipelines)
├── package.json                   # Root deps (turbo, typescript)
├── tsconfig.json                  # Base TS config
├── .gitignore                     # Node_modules, .env, chroma_db
└── README.md                      # Setup, run commands (e.g., turbo run dev)
```

# Project development plan
| Phase                  | Focus                          | Duration | Key Deliverables                                                                 | Tools/Stack                                      | Effort (Hours) | Success Metric                                      |
|------------------------|--------------------------------|----------|----------------------------------------------------------------------------------|--------------------------------------------------|----------------|-----------------------------------------------------|
| 0: Runnable Mockup    | Validate UI/UX flow            | 3-5 days | Interactive wireframe + basic prototype                                          | Figma, CodeSandbox                               | 10-15          | Clickable demo with upload/chat simulation          |
| 1: MVP Core           | Build essentials (Indices 1-3) | 2 weeks  | Deployable app with file upload, viewer, basic RAG chat                          | React, PDF.js, LangChain (basic RAG from notebook)| 40-50          | End-to-end test: Upload PDF → Highlight → Query → Response (<2s) |
| 2: Usable Enhancements| Add polish (Indices 4-8)       | 2 weeks  | Auth, annotations, search, offline basics                                        | Firebase, Zustand, Vitest                        | 40-50          | User testing: 5 beta users complete a study session |
| 3: Advanced Innovations| Differentiate (Indices 9-13)  | 3 weeks  | Integrations, adaptive paths, modes, collab                                      | Quizlet API, LangGraph (agentic RAG), Firebase Realtime | 60-70          | Feature parity: Generate quiz → Export to Quizlet   |
| 4: Polish & Launch    | Production-ready               | 1-2 weeks| Full deploy, monitoring, docs                                                    | Vercel, Sentry, OpenAPI                          | 20-30          | Live app: 100 users, <5% error rate