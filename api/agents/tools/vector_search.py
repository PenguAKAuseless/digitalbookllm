"""
Vector Search Tool for local document retrieval.
"""
from typing import List, Dict, Any, Optional
from agents.base import BaseTool
from database.vector_db import qdrant_client, SearchResult
from services.embedding_service import embedding_service


class VectorSearchTool(BaseTool):
    """Tool for semantic search over document chunks using vector similarity."""

    name = "vector_search"
    description = """Search through uploaded documents using semantic similarity.
    Use this tool when you need to find relevant information from the user's documents.
    Input should be a search query string."""

    def __init__(self):
        self.qdrant = qdrant_client

    async def execute(
        self,
        query: str,
        workspace_id: str,
        document_id: Optional[str] = None,
        top_k: int = 5,
        score_threshold: float = 0.2,
    ) -> List[Dict[str, Any]]:
        """
        Execute vector search over documents.

        Args:
            query: Search query string
            workspace_id: ID of the workspace to search in
            document_id: Optional specific document to search
            top_k: Number of results to return
            score_threshold: Minimum similarity score

        Returns:
            List of relevant document chunks with metadata
        """
        query_embedding = await embedding_service.generate_embedding(query)

        if document_id:
            results = self.qdrant.search(
                query_vector=query_embedding,
                workspace_id=workspace_id,
                document_id=document_id,
                top_k=top_k,
                score_threshold=score_threshold,
            )
        else:
            results = self.qdrant.search_workspace(
                query_vector=query_embedding,
                workspace_id=workspace_id,
                top_k=top_k,
                score_threshold=score_threshold,
            )

        return [
            {
                "id": r.id,
                "text": r.text,
                "similarity": r.score,
                "document_id": r.document_id,
                "document_name": r.document_name,
                "chunk_index": r.chunk_index,
            }
            for r in results
        ]

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to find relevant documents",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of results to return (default: 5)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        }
