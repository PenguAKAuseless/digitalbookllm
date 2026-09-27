"""
Qdrant Vector Database service with HNSW indexing.
"""
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

from config import settings


@dataclass
class SearchResult:
    id: str
    text: str
    score: float
    document_id: str
    document_name: Optional[str] = None
    chunk_index: int = 0
    metadata: Optional[Dict[str, Any]] = None


class QdrantService:
    """Service for managing vector storage and retrieval with Qdrant."""

    def __init__(self):
        self.client = QdrantClient(
            host=settings.QDRANT_HOST,
            port=settings.QDRANT_PORT,
        )
        self.collection_name = settings.QDRANT_COLLECTION
        self.vector_size = settings.EMBEDDING_DIMENSION

    async def initialize(self) -> None:
        """Initialize the Qdrant collection with HNSW indexing."""
        collections = self.client.get_collections().collections
        collection_names = [c.name for c in collections]

        if self.collection_name not in collection_names:
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=self.vector_size,
                    distance=Distance.COSINE,
                    on_disk=True,
                ),
                hnsw_config=models.HnswConfigDiff(
                    m=16,
                    ef_construct=100,
                    full_scan_threshold=10000,
                ),
                optimizers_config=models.OptimizersConfigDiff(
                    indexing_threshold=20000,
                ),
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="workspace_id",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="document_id",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            print(f"Created Qdrant collection: {self.collection_name}")

    def upsert_chunks(
        self,
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]],
    ) -> None:
        """Upsert document chunks with their embeddings."""
        points = [
            PointStruct(
                id=chunk["id"],
                vector=embedding,
                payload={
                    "text": chunk["text"],
                    "document_id": chunk["document_id"],
                    "document_name": chunk.get("document_name", ""),
                    "workspace_id": chunk["workspace_id"],
                    "chunk_index": chunk["chunk_index"],
                },
            )
            for chunk, embedding in zip(chunks, embeddings)
        ]
        self.client.upsert(
            collection_name=self.collection_name,
            points=points,
            wait=True,
        )

    def search(
        self,
        query_vector: List[float],
        workspace_id: str,
        document_id: Optional[str] = None,
        top_k: int = 5,
        score_threshold: float = 0.0,
    ) -> List[SearchResult]:
        """Search for similar chunks using HNSW index."""
        filter_conditions = [
            FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id))
        ]
        if document_id:
            filter_conditions.append(
                FieldCondition(key="document_id", match=MatchValue(value=document_id))
            )

        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            query_filter=Filter(must=filter_conditions),
            limit=top_k,
            score_threshold=score_threshold,
            with_payload=True,
        )

        return [
            SearchResult(
                id=str(r.id),
                text=r.payload.get("text", ""),
                score=r.score,
                document_id=r.payload.get("document_id", ""),
                document_name=r.payload.get("document_name"),
                chunk_index=r.payload.get("chunk_index", 0),
                metadata=r.payload,
            )
            for r in results
        ]

    def search_workspace(
        self,
        query_vector: List[float],
        workspace_id: str,
        top_k: int = 5,
        score_threshold: float = 0.0,
    ) -> List[SearchResult]:
        """Search across all documents in a workspace."""
        return self.search(
            query_vector=query_vector,
            workspace_id=workspace_id,
            document_id=None,
            top_k=top_k,
            score_threshold=score_threshold,
        )

    def delete_document_chunks(self, document_id: str) -> None:
        """Delete all chunks for a document."""
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=models.FilterSelector(
                filter=Filter(
                    must=[
                        FieldCondition(
                            key="document_id",
                            match=MatchValue(value=document_id),
                        )
                    ]
                )
            ),
        )

    def delete_workspace_chunks(self, workspace_id: str) -> None:
        """Delete all chunks for a workspace."""
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=models.FilterSelector(
                filter=Filter(
                    must=[
                        FieldCondition(
                            key="workspace_id",
                            match=MatchValue(value=workspace_id),
                        )
                    ]
                )
            ),
        )

    def get_collection_info(self) -> Dict[str, Any]:
        """Get collection statistics."""
        info = self.client.get_collection(self.collection_name)
        return {
            "vectors_count": info.vectors_count,
            "points_count": info.points_count,
            "status": info.status,
        }


qdrant_client = QdrantService()
