# Setup

## Prerequisites

- Node.js 18+
- npm
- PostgreSQL 14+ with `pgvector`

## Database

```powershell
psql -U postgres -c "CREATE DATABASE digitalbookllm;"
psql -U postgres -d digitalbookllm -c "CREATE EXTENSION vector;"
```

## Backend

```powershell
cd backend
npm install
cp .env.example .env
npm run migrate
npm run dev
```

Default backend URL: `http://localhost:3001`

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Default frontend URL: `http://localhost:3000`

## Environment

Frontend `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

Backend `backend/.env` key variables:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=digitalbookllm
PORT=3001
MAX_QUERIES_PER_DAY=50
MAX_FILE_SIZE_MB=100
```

## Smoke Test

1. Upload a document from the sidebar.
2. Open the document and select text.
3. Ask a question in chat.
4. Use the speaker icon on an assistant message to test TTS.
