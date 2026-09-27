"""Pydantic schemas for Glossary endpoints."""
from typing import Optional, List
from pydantic import BaseModel, Field


class GlossaryLookupRequest(BaseModel):
    """Request schema for glossary lookup."""
    terms: List[str] = Field(..., min_length=1, description="Terms to look up")
    workspace_id: str = Field(..., description="Workspace ID")


class GlossaryTermResponse(BaseModel):
    """Response schema for a single glossary term."""
    id: str
    term: str
    definition: str
    category: Optional[str] = None
    frequency: int = 1


class GlossarySearchRequest(BaseModel):
    """Request schema for glossary search."""
    query: str = Field(..., min_length=1, description="Search query")
    workspace_id: str = Field(..., description="Workspace ID")
    limit: int = Field(20, ge=1, le=100, description="Maximum results")


class GlossaryAddRequest(BaseModel):
    """Request schema for adding a glossary term."""
    workspace_id: str = Field(..., description="Workspace ID")
    term: str = Field(..., min_length=1, description="Term to add")
    definition: str = Field(..., min_length=1, description="Definition")
    category: Optional[str] = Field(None, description="Category/type")


class GlossaryListResponse(BaseModel):
    """Response schema for listing glossary terms."""
    terms: List[GlossaryTermResponse]
    pagination: dict
