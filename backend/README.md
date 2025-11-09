# DigitalBookLLM Backend

Backend API for DigitalBookLLM with PostgreSQL and RAG (Retrieval-Augmented Generation) support.

## Features

- 📄 Document upload and processing (PDF, DOCX, TXT, MD)
- 🔍 Vector similarity search using pgvector
- 🤖 RAG-powered chat with prioritized context
- 📊 PostgreSQL database with vector embeddings
- ⚡ Rate limiting and security middleware
- 🎯 TypeScript for type safety

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ with pgvector extension
- (Optional) Together AI API key for real AI responses

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Setup PostgreSQL:**
```bash
# Install PostgreSQL and pgvector extension
# On Windows with PostgreSQL installed:
psql -U postgres -c "CREATE DATABASE digitalbookllm;"
psql -U postgres -d digitalbookllm -c "CREATE EXTENSION vector;"
```

3. **Configure environment:**
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your database credentials
# Update DB_PASSWORD with your PostgreSQL password
```

4. **Run database migrations:**
```bash
npm run migrate
```

## Usage

### Development
```bash
npm run dev
```

Server will start on http://localhost:3001

### Production
```bash
npm run build
npm start
```

## API Endpoints

### Documents
- `POST /api/documents/upload` - Upload a document
- `GET /api/documents` - Get all user documents
- `GET /api/documents/:id` - Get specific document
- `DELETE /api/documents/:id` - Delete document

### RAG Chat
- `POST /api/rag/query` - Query with RAG
- `GET /api/rag/history/:documentId` - Get chat history
- `GET /api/rag/query-count` - Get remaining queries

### Health Check
- `GET /health` - Server health status

## Project Structure

```
backend/
├── src/
│   ├── controllers/      # Request handlers
│   ├── db/              # Database config and migrations
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── services/        # Business logic (RAG, embeddings, documents)
│   ├── types/           # TypeScript interfaces
│   └── index.ts         # Application entry point
├── uploads/             # Temporary file uploads
├── .env                 # Environment variables
└── package.json
```

## Configuration

Key environment variables in `.env`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=digitalbookllm

# Server
PORT=3001

# LLM API (optional - will use mock responses if not set)
# Optional: Real AI responses
TOGETHER_API_KEY=your_together_api_key_here
TOGETHER_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo

# Rate Limiting
MAX_QUERIES_PER_DAY=50
```

## RAG Architecture

1. **Document Processing:**
   - Extract text from uploaded files
   - Split into semantic chunks (500 words with 50 word overlap)
   - Generate embeddings using all-MiniLM-L6-v2
   - Store in PostgreSQL with pgvector

3. **Query Processing (Prioritized RAG):**
   - User selects text (Primary Context)
   - Embed query + selected text
   - Retrieve top-K similar chunks using cosine similarity
   - De-duplicate chunks similar to selected text
   - Construct prioritized prompt for LLM
   - Generate response using Together AI (or mock)

## Development Notes

- First run will download embedding model (~100MB)
- Mock AI responses used if TOGETHER_API_KEY not configured
- Guest user (ID: 'guest') created automatically for testing
- Rate limit: 50 queries/day per user

## Troubleshooting

**Database connection fails:**
```bash
# Check PostgreSQL is running
# Verify credentials in .env
# Ensure database exists: digitalbookllm
```

**pgvector extension error:**
```bash
# Install pgvector extension
psql -U postgres -d digitalbookllm -c "CREATE EXTENSION vector;"
```

**Module not found errors:**
```bash
npm install
```

## License

MIT
