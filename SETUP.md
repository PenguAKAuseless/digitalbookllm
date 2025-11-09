# DigitalBookLLM - Complete Setup Guide

This guide will walk you through setting up and running the complete DigitalBookLLM application locally.

## Prerequisites

- **Node.js 18+** and npm
- **PostgreSQL 14+** with pgvector extension
- Git
- (Optional) Grok API key for real AI responses

## Quick Start

### 1. Install PostgreSQL with pgvector

#### Windows:
```powershell
# Download and install PostgreSQL from https://www.postgresql.org/download/windows/
# After installation, enable pgvector:
psql -U postgres -c "CREATE EXTENSION vector;"
```

#### Alternative: Using Docker (Recommended for quick setup)
```powershell
docker run -d --name digitalbookllm-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg16
```

### 2. Setup Database

```powershell
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE digitalbookllm;

# Connect to the new database
\c digitalbookllm

# Enable pgvector extension
CREATE EXTENSION vector;

# Exit psql
\q
```

### 3. Setup Backend

```powershell
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env file with your database credentials
# (Open .env in a text editor and update DB_PASSWORD)

# Run database migrations
npm run migrate

# Start backend server
npm run dev
```

Backend will run on http://localhost:3001

### 4. Setup Frontend

```powershell
# Open a new terminal
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will run on http://localhost:3000

### 5. Access the Application

Open your browser and navigate to:
**http://localhost:3000**

## Features to Test

1. **Upload a Document**
   - Click "Upload Document" in the sidebar
   - Select a PDF, DOCX, TXT, or MD file
   - Wait for processing (embedding generation)

2. **View Document**
   - Click on the uploaded document in the sidebar
   - Use zoom controls to adjust view
   - Select text to highlight

3. **Chat with AI**
   - Select text from the document (optional but recommended)
   - Type a question in the chat panel
   - Press Enter or click Send
   - View AI-generated response based on document context

4. **Track Usage**
   - Check query count at the bottom of chat panel
   - Free tier: 50 queries per day

## Configuration

### Backend (.env)

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=digitalbookllm

# Server
PORT=3001
NODE_ENV=development

# Optional: Real AI responses
GROK_API_KEY=your_grok_api_key_here

# Rate Limiting
MAX_QUERIES_PER_DAY=50

# File Upload
MAX_FILE_SIZE_MB=100
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## Troubleshooting

### Backend won't start

**Error: Connection refused**
```
Solution: Ensure PostgreSQL is running
Windows: Check Services (postgres service should be running)
Docker: docker ps (container should be running)
```

**Error: database "digitalbookllm" does not exist**
```powershell
psql -U postgres -c "CREATE DATABASE digitalbookllm;"
```

**Error: extension "vector" does not exist**
```powershell
psql -U postgres -d digitalbookllm -c "CREATE EXTENSION vector;"
```

### Frontend API errors

**Network Error or CORS issues**
```
1. Ensure backend is running on port 3001
2. Check NEXT_PUBLIC_API_URL in frontend/.env.local
3. Restart frontend dev server after .env changes
```

### Document upload fails

**File too large**
```
Default max size: 100MB
Update MAX_FILE_SIZE_MB in backend/.env
```

**Unsupported file type**
```
Supported: PDF, DOCX, TXT, MD
Check file extension matches content type
```

### Slow embedding generation

**First upload takes longer**
```
Embedding model downloads on first use (~100MB)
Subsequent uploads will be faster
Progress shown in backend console
```

## Development Tips

### Reset Database
```powershell
cd backend
psql -U postgres -d digitalbookllm -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run migrate
```

### View Backend Logs
```powershell
cd backend
npm run dev
# Logs show document processing, embeddings, queries
```

### Test API Directly
```powershell
# Health check
curl http://localhost:3001/health

# Get documents
curl http://localhost:3001/api/documents?userId=guest
```

## Production Deployment

For production deployment, see:
- Backend: `backend/README.md`
- Frontend: Next.js deployment docs
- Database: Use managed PostgreSQL with pgvector support

## Support

For issues or questions:
1. Check console logs (browser + backend)
2. Verify all services are running
3. Review .env configuration
4. Check database connection

## Architecture Overview

```
Frontend (Next.js) → Backend API (Express) → PostgreSQL (pgvector)
                                          ↓
                                    Embeddings (Transformers.js)
                                          ↓
                                    LLM API (Grok/Mock)
```

## Next Steps

- Configure real LLM API (Grok) for better responses
- Add authentication (Firebase, Auth0)
- Deploy to production (Vercel + Railway/Supabase)
- Enable collaboration features
- Add more document formats
