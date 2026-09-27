"""
RAG Router - Handles Agentic RAG queries and summarization.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from database.models import Document, Workspace
from schemas.rag import (
    RAGQueryRequest,
    RAGQueryResponse,
    SummarizeRequest,
    SummarizeResponse,
)
from pipelines.agentic_rag import AgenticRAGManager
from pipelines.glossary import DynamicGlossaryManager
from services.llm_service import llm_service

router = APIRouter(prefix="/rag", tags=["RAG"])


async def get_agentic_rag(db: AsyncSession = Depends(get_db)) -> AgenticRAGManager:
    """Dependency to get AgenticRAGManager instance."""
    glossary_manager = DynamicGlossaryManager(db)
    return AgenticRAGManager(
        db_session=db,
        llm_service=llm_service,
        glossary_manager=glossary_manager,
    )


@router.post("/query", response_model=RAGQueryResponse)
async def agentic_query(
    request: RAGQueryRequest,
    db: AsyncSession = Depends(get_db),
    rag_manager: AgenticRAGManager = Depends(get_agentic_rag),
):
    """
    Process a query through the Agentic RAG pipeline.

    This uses the ReAct paradigm:
    1. Plan: Decompose complex queries into sub-queries
    2. Reason: Decide what information is needed
    3. Act: Execute tools (Vector Search, Knowledge Graph, Web Search)
    4. Generate: Create the final response

    Hard iteration limit (5) prevents infinite loops.
    """
    workspace = await db.execute(
        select(Workspace).where(Workspace.id == request.workspace_id)
    )
    if not workspace.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workspace not found")

    try:
        result = await rag_manager.process_query(
            query=request.query,
            workspace_id=request.workspace_id,
            document_id=request.document_id,
            selected_text=request.selected_text,
        )

        return RAGQueryResponse(
            response=result["response"],
            reasoning_trace=result.get("reasoning_trace"),
            sub_queries=result.get("sub_queries"),
            iterations=result.get("iterations"),
            glossary_terms=result.get("glossary_terms"),
            source="document" if request.document_id else "workspace",
            provider="agentic_rag",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_document(
    request: SummarizeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a summary of a document.

    Summary types:
    - key_points: Bullet-point key takeaways
    - executive: Brief executive summary
    - detailed: Comprehensive summary
    """
    doc_result = await db.execute(
        select(Document).where(Document.id == request.document_id)
    )
    document = doc_result.scalar_one_or_none()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    prompts = {
        "key_points": f"""Summarize the following document as a list of key points (5-10 bullet points).

Document: {document.name}

Content:
{document.full_text[:10000]}

Provide:
1. A brief overview (2-3 sentences)
2. Key points as bullet points
""",
        "executive": f"""Write an executive summary (3-5 paragraphs) of the following document.

Document: {document.name}

Content:
{document.full_text[:10000]}

Focus on main findings, conclusions, and actionable insights.
""",
        "detailed": f"""Provide a detailed summary of the following document, organized by sections.

Document: {document.name}

Content:
{document.full_text[:15000]}

Include all major topics and their key details.
""",
    }

    prompt = prompts.get(request.summary_type, prompts["key_points"])

    try:
        summary = await llm_service.generate(prompt, max_tokens=request.max_length)

        key_points = []
        for line in summary.split("\n"):
            line = line.strip()
            if line.startswith(("-", "•", "*", "·")):
                key_points.append(line.lstrip("-•*· "))

        return SummarizeResponse(
            summary=summary,
            key_points=key_points[:10],
            document_name=document.name,
            word_count=len(summary.split()),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
