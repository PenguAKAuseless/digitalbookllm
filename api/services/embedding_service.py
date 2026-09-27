"""
Embedding Service using sentence-transformers.
Generates 384-dimensional embeddings compatible with existing pgvector setup.
"""
import asyncio
from typing import List
from sentence_transformers import SentenceTransformer

from config import settings


class EmbeddingService:
    """Service for generating text embeddings."""

    def __init__(self):
        self._model = None
        self._model_name = settings.EMBEDDING_MODEL

    def _ensure_model_loaded(self) -> None:
        """Lazy-load the embedding model."""
        if self._model is None:
            print(f"[Embedding] Loading model: {self._model_name}")
            self._model = SentenceTransformer(self._model_name)
            print(f"[Embedding] Model loaded (dim={self._model.get_sentence_embedding_dimension()})")

    async def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Input text to embed

        Returns:
            List of floats representing the embedding vector
        """
        return await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self._generate_embedding_sync(text),
        )

    def _generate_embedding_sync(self, text: str) -> List[float]:
        """Synchronous embedding generation."""
        self._ensure_model_loaded()
        embedding = self._model.encode(text, convert_to_numpy=True)
        return embedding.tolist()

    async def generate_embeddings_batch(
        self,
        texts: List[str],
        batch_size: int = 32,
    ) -> List[List[float]]:
        """
        Generate embeddings for multiple texts efficiently.

        Args:
            texts: List of texts to embed
            batch_size: Batch size for encoding

        Returns:
            List of embedding vectors
        """
        return await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self._generate_embeddings_batch_sync(texts, batch_size),
        )

    def _generate_embeddings_batch_sync(
        self,
        texts: List[str],
        batch_size: int,
    ) -> List[List[float]]:
        """Synchronous batch embedding generation."""
        self._ensure_model_loaded()
        embeddings = self._model.encode(
            texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [e.tolist() for e in embeddings]

    def get_embedding_dimension(self) -> int:
        """Get the embedding dimension."""
        self._ensure_model_loaded()
        return self._model.get_sentence_embedding_dimension()


embedding_service = EmbeddingService()
