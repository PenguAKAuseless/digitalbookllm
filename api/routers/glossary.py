"""
Glossary Router - Fast lookup API for frontend tooltips.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from database import get_db
from schemas.glossary import (
    GlossaryLookupRequest,
    GlossaryTermResponse,
    GlossarySearchRequest,
    GlossaryAddRequest,
    GlossaryListResponse,
)
from pipelines.glossary import DynamicGlossaryManager

router = APIRouter(prefix="/glossary", tags=["Glossary"])


@router.post("/lookup", response_model=List[GlossaryTermResponse])
async def lookup_terms(
    request: GlossaryLookupRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Fast lookup for multiple terms.

    Use this endpoint for frontend tooltips - it's optimized for
    quick lookups of known terms.
    """
    glossary = DynamicGlossaryManager(db)
    results = await glossary.lookup_terms(
        terms=request.terms,
        workspace_id=request.workspace_id,
    )
    return [GlossaryTermResponse(**t) for t in results]


@router.get("/search", response_model=List[GlossaryTermResponse])
async def search_terms(
    workspace_id: str = Query(..., description="Workspace ID"),
    query: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(20, ge=1, le=100, description="Max results"),
    db: AsyncSession = Depends(get_db),
):
    """
    Search glossary terms by partial match.

    Returns terms where the term name contains the query string.
    """
    glossary = DynamicGlossaryManager(db)
    results = await glossary.search_terms(
        query=query,
        workspace_id=workspace_id,
        limit=limit,
    )
    return [GlossaryTermResponse(**t) for t in results]


@router.get("/list", response_model=GlossaryListResponse)
async def list_terms(
    workspace_id: str = Query(..., description="Workspace ID"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """
    List all glossary terms for a workspace with pagination.
    """
    glossary = DynamicGlossaryManager(db)
    result = await glossary.get_all_terms(
        workspace_id=workspace_id,
        page=page,
        page_size=page_size,
    )
    return GlossaryListResponse(
        terms=[GlossaryTermResponse(**t) for t in result["terms"]],
        pagination=result["pagination"],
    )


@router.post("/add", response_model=GlossaryTermResponse)
async def add_term(
    request: GlossaryAddRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually add or update a glossary term.

    If the term already exists, it will be updated.
    """
    glossary = DynamicGlossaryManager(db)
    result = await glossary.add_term(
        workspace_id=request.workspace_id,
        term=request.term,
        definition=request.definition,
        category=request.category,
    )
    return GlossaryTermResponse(
        id=result["id"],
        term=result["term"],
        definition=result["definition"],
        category=request.category,
        frequency=1,
    )


@router.delete("/{term_id}")
async def delete_term(
    term_id: str,
    workspace_id: str = Query(..., description="Workspace ID"),
    db: AsyncSession = Depends(get_db),
):
    """Delete a glossary term."""
    glossary = DynamicGlossaryManager(db)
    deleted = await glossary.delete_term(term_id, workspace_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Term not found")
    return {"success": True, "message": "Term deleted"}
