"""
DigitalBookLLM - Advanced Academic Assistant API

FastAPI backend with:
- Agentic RAG (ReAct paradigm)
- Graph RAG with Knowledge Triplet extraction
- Dynamic Glossary with NER
- Dynamic LoRA adapter routing
- Quiz and Flashcard generation
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import settings
from database import init_db
from database.vector_db import qdrant_client
from routers import rag_router, glossary_router, quiz_router, graph_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    print("[Startup] Initializing database...")
    await init_db()

    print("[Startup] Initializing Qdrant...")
    await qdrant_client.initialize()

    print("[Startup] DigitalBookLLM API ready!")
    yield
    print("[Shutdown] Cleaning up...")


app = FastAPI(
    title=settings.APP_NAME,
    description="""
    Advanced Academic Assistant with Agentic RAG.

    ## Features
    - **Agentic RAG**: ReAct paradigm with Planning → Reasoning → Action loop
    - **Graph RAG**: Knowledge triplet extraction and graph-based retrieval
    - **Dynamic Glossary**: NER-based term extraction with query enrichment
    - **Quiz Generation**: AI-generated quizzes with flashcard mode
    - **LoRA Routing**: Domain-specific model adaptation

    ## API Versioning
    This is API v2, designed to run alongside the existing Express backend.
    """,
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rag_router, prefix=settings.API_PREFIX)
app.include_router(glossary_router, prefix=settings.API_PREFIX)
app.include_router(quiz_router, prefix=settings.API_PREFIX)
app.include_router(graph_router, prefix=settings.API_PREFIX)


@app.get("/")
async def root():
    """API root endpoint."""
    return {
        "name": settings.APP_NAME,
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
        "features": [
            "Agentic RAG with ReAct loop",
            "Knowledge Graph extraction",
            "Dynamic Glossary",
            "Quiz & Flashcard generation",
            "LoRA adapter routing",
        ],
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from database.postgres import test_connection

    db_healthy = await test_connection()

    return {
        "status": "healthy" if db_healthy else "degraded",
        "database": "connected" if db_healthy else "disconnected",
        "api_version": "2.0.0",
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
