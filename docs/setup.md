# Setup

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL with pgvector)
- npm

## 1. Start PostgreSQL

```bash
cd backend
npm run docker:up   # starts postgres container on port 5433
```

## 2. Configure backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`. Minimum required:
```
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=digitalbookllm
JWT_SECRET=your-secret-here
```

Add LLM provider keys (optional — system falls back to local Xenova model):
```
TOGETHER_API_KEY=...    # or
OPENAI_API_KEY=...      # or
ANTHROPIC_API_KEY=...   # or
GROQ_API_KEY=...
```

For local Ollama (optional, better quality than Xenova fallback):
```
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

## 3. Run migration

```bash
cd backend && npm run migrate
```

## 4. Start backend

```bash
cd backend && npm run dev
```

Backend runs on `http://localhost:3001`.

## 5. Start frontend

```bash
cd frontend && npm run dev
```

Frontend runs on `http://localhost:3000`.

## 6. First use

1. Open `http://localhost:3000`
2. Register an account
3. Create a workspace
4. Upload documents (PDF, DOCX, TXT, MD, etc.)
5. Select a document and start chatting

## LLM Provider Priority

The system tries providers in order and uses the first one that has a valid API key:

1. Together AI (`TOGETHER_API_KEY`)
2. OpenAI (`OPENAI_API_KEY`)
3. Anthropic (`ANTHROPIC_API_KEY`)
4. Groq (`GROQ_API_KEY`)
5. Ollama local (`OLLAMA_URL` set)
6. Xenova `flan-t5-base` (always available, no config)

If no keys are set, Xenova handles generation locally on CPU.
