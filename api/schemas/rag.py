"""Pydantic schemas for RAG endpoints."""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class RAGQueryRequest(BaseModel):
    """Request schema for RAG query."""
    query: str = Field(..., min_length=1, description="User's question")
    workspace_id: str = Field(..., description="Workspace ID")
    document_id: Optional[str] = Field(None, description="Specific document to focus on")
    selected_text: Optional[str] = Field(None, description="User-selected text context")
    session_id: Optional[str] = Field(None, description="Chat session ID for continuity")
    top_k: int = Field(5, ge=1, le=20, description="Number of chunks to retrieve")


class ReasoningStep(BaseModel):
    """A single step in the reasoning trace."""
    step: int
    thought: str
    action: Optional[str] = None
    action_input: Optional[Dict[str, Any]] = None
    result_summary: Optional[str] = None


class RAGQueryResponse(BaseModel):
    """Response schema for RAG query."""
    response: str = Field(..., description="Generated answer")
    session_id: Optional[str] = Field(None, description="Chat session ID")
    message_id: Optional[str] = Field(None, description="Message ID")
    source: str = Field("none", description="Source type: document, workspace, or none")
    source_document_name: Optional[str] = Field(None, description="Name of source document")
    provider: Optional[str] = Field(None, description="LLM provider used")
    reasoning_trace: Optional[Dict[str, Any]] = Field(None, description="Full reasoning trace")
    sub_queries: Optional[List[str]] = Field(None, description="Decomposed sub-queries")
    iterations: Optional[int] = Field(None, description="Number of ReAct iterations")
    glossary_terms: Optional[List[Dict[str, str]]] = Field(None, description="Injected glossary terms")
    retrieved_chunks: Optional[List[Dict[str, Any]]] = Field(None, description="Retrieved context chunks")


class SummarizeRequest(BaseModel):
    """Request schema for document summarization."""
    document_id: str = Field(..., description="Document to summarize")
    workspace_id: str = Field(..., description="Workspace ID")
    summary_type: str = Field("key_points", description="Type: key_points, executive, detailed")
    max_length: int = Field(500, ge=100, le=2000, description="Maximum summary length")


class SummarizeResponse(BaseModel):
    """Response schema for summarization."""
    summary: str
    key_points: List[str]
    document_name: str
    word_count: int
