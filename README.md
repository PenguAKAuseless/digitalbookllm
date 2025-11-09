# DigitalBookLLM

Your AI-Powered Learning Companion for Documents - Transform static PDFs, textbooks, and research papers into dynamic, intelligent study sessions.

## 🌟 Features

- **📄 Document Upload & Management** - Support for PDF, DOCX, TXT, and Markdown files
- **🔍 Smart Document Viewer** - Zoom, highlight, and annotate with ease
- **💬 AI Chat Assistant** - Context-aware responses powered by RAG (Retrieval-Augmented Generation)
- **🎯 Prioritized Context** - Select text for focused, accurate AI responses
- **📊 Vector Search** - Fast semantic search using PostgreSQL pgvector
- **⚡ Real-time Interaction** - Split-screen layout for seamless document + chat experience
- **🔒 Privacy-First** - Local processing, rate-limited queries, secure storage

## 🚀 Quick Start

See **[SETUP.md](./SETUP.md)** for detailed installation instructions.

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ with pgvector
- npm

### Installation

```bash
# 1. Setup database
psql -U postgres -c "CREATE DATABASE digitalbookllm;"
psql -U postgres -d digitalbookllm -c "CREATE EXTENSION vector;"

# 2. Backend setup
cd backend
npm install
cp .env.example .env
# Edit .env with your database credentials
npm run migrate
npm run dev

# 3. Frontend setup (new terminal)
cd frontend
npm install
npm run dev
```

Visit **http://localhost:3000** to start using DigitalBookLLM!

## 📁 Project Structure

```
digitalbookllm/
├── backend/                    # Express + TypeScript API
│   ├── src/
│   │   ├── controllers/       # API request handlers
│   │   ├── services/          # RAG, embeddings, documents
│   │   ├── db/               # PostgreSQL + pgvector
│   │   └── routes/           # API endpoints
│   └── package.json
│
├── frontend/                   # Next.js + React app
│   ├── app/                   # Pages and layouts
│   ├── components/            # UI components
│   │   ├── chat-panel.tsx    # AI chat interface
│   │   ├── document-viewer.tsx # Document display
│   │   └── sidebar.tsx       # File library
│   ├── lib/                   # API clients and utilities
│   └── package.json
│
└── documentation/             # Project docs and planning
    ├── priority-rag.md       # RAG architecture
    ├── structure.md          # Project structure
    └── summary.md            # Feature overview
```

## 🎯 How It Works

### 1. Upload & Index
- Upload documents (PDF, DOCX, TXT, MD)
- Text extracted and split into semantic chunks
- Embeddings generated using all-MiniLM-L6-v2
- Stored in PostgreSQL with vector search

### 2. Prioritized RAG
- **Primary Context**: User-selected text (highest priority)
- **Augmented Context**: Similar chunks from vector search
- **Smart De-duplication**: Removes redundant chunks
- **Structured Prompt**: Clear hierarchy for LLM

### 3. AI Response
- Query processed with selected text
- Top-K similar chunks retrieved via cosine similarity
- Prompt constructed with prioritized context
- Response generated using Grok API (or mock for dev)

## 🛠 Technology Stack

### Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with pgvector extension
- **Embeddings**: @xenova/transformers (all-MiniLM-L6-v2)
- **LLM**: Grok API (configurable)
- **File Processing**: pdf-parse, mammoth, multer

### Frontend
- **Framework**: Next.js 16 (React 19)
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **Icons**: Lucide React
- **State Management**: React Hooks

## 📚 API Endpoints

### Documents
- `POST /api/documents/upload` - Upload document
- `GET /api/documents` - List user documents
- `GET /api/documents/:id` - Get document details
- `DELETE /api/documents/:id` - Delete document

### RAG Chat
- `POST /api/rag/query` - Send query with RAG
- `GET /api/rag/history/:documentId` - Get chat history
- `GET /api/rag/query-count` - Get remaining queries

## 🎨 Key Features in Detail

### Document Viewer
- **Zoom Controls**: 50% - 200% scaling
- **Text Selection**: Highlight and select text for context
- **Responsive Design**: Desktop and mobile optimized
- **Format Support**: Auto-formats paragraphs and headings

### AI Chat Panel
- **Context-Aware**: Uses selected text as primary context
- **Chat History**: Persists conversations per document
- **Rate Limiting**: 50 queries/day (configurable)
- **Quick Actions**: Pre-defined prompts for common tasks
- **Feedback**: Copy, thumbs up/down for responses

### Sidebar Library
- **Upload**: Drag-and-drop or click to upload
- **Search**: Filter documents by name
- **Recent Files**: Sorted by last modified
- **File Info**: Name, size, upload date

## 🔧 Configuration

### Environment Variables

**Backend** (`backend/.env`):
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=digitalbookllm
PORT=3001
GROK_API_KEY=your_api_key  # Optional for real AI
MAX_QUERIES_PER_DAY=50
MAX_FILE_SIZE_MB=100
```

**Frontend** (`frontend/.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## 🧪 Development

### Backend
```bash
cd backend
npm run dev      # Start with hot reload
npm run build    # Build for production
npm run migrate  # Run database migrations
```

### Frontend
```bash
cd frontend
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Lint code
```

## 📖 Documentation

- **[SETUP.md](./SETUP.md)** - Complete setup guide with troubleshooting
- **[backend/README.md](./backend/README.md)** - Backend API documentation
- **[documentation/priority-rag.md](./documentation/priority-rag.md)** - RAG architecture details
- **[documentation/structure.md](./documentation/structure.md)** - Project structure plan
- **[documentation/summary.md](./documentation/summary.md)** - Feature overview

## 🤝 Contributing

This is a demo/mockup project. For production use:
1. Add proper authentication (Firebase, Auth0)
2. Implement real LLM integration
3. Add comprehensive error handling
4. Implement file encryption
5. Add unit and integration tests
6. Set up CI/CD pipeline

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- Built with inspiration from NotebookLM and VS Code Copilot
- Uses open-source models and libraries
- Designed for educational and research purposes

## 📞 Support

For issues, questions, or feature requests:
1. Check [SETUP.md](./SETUP.md) troubleshooting section
2. Review console logs (browser + backend)
3. Verify database and service connections
4. Check environment configuration

---

**Made with ❤️ for better learning experiences**
