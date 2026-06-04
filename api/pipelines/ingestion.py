"""
Async Ingestion Pipeline for document processing.

Implements:
1. Text chunking with overlap
2. Knowledge Triplet extraction (Subject, Relation, Object) via Few-Shot LLM
3. Vector embedding generation and indexing
4. NER-based glossary term extraction
"""
import asyncio
import json
import re
import uuid
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from database.models import Document, Chunk, KnowledgeTriplet, GlossaryTerm
from database.vector_db import qdrant_client
from services.embedding_service import embedding_service
from services.llm_service import LLMService
from services.ner_service import NERService


TRIPLET_EXTRACTION_PROMPT = """You are a knowledge extraction expert. Extract knowledge triplets (Subject, Relation, Object) from the given text.

## Few-Shot Examples

Text: "Albert Einstein developed the theory of relativity in 1905."
Triplets:
```json
[
    {{"subject": "Albert Einstein", "relation": "developed", "object": "theory of relativity"}},
    {{"subject": "theory of relativity", "relation": "developed_in", "object": "1905"}}
]
```

Text: "Python is a programming language created by Guido van Rossum. It is widely used for machine learning."
Triplets:
```json
[
    {{"subject": "Python", "relation": "is_a", "object": "programming language"}},
    {{"subject": "Python", "relation": "created_by", "object": "Guido van Rossum"}},
    {{"subject": "Python", "relation": "used_for", "object": "machine learning"}}
]
```

Text: "The mitochondria is the powerhouse of the cell. It produces ATP through cellular respiration."
Triplets:
```json
[
    {{"subject": "mitochondria", "relation": "is", "object": "powerhouse of the cell"}},
    {{"subject": "mitochondria", "relation": "produces", "object": "ATP"}},
    {{"subject": "ATP", "relation": "produced_through", "object": "cellular respiration"}}
]
```

## Your Task
Extract knowledge triplets from the following text. Return ONLY valid JSON array.

Text: "{text}"

Triplets:
"""


@dataclass
class ChunkData:
    """Represents a document chunk during processing."""
    id: str
    text: str
    chunk_index: int
    document_id: str
    workspace_id: str
    document_name: str


@dataclass
class TripletData:
    """Represents an extracted knowledge triplet."""
    subject: str
    relation: str
    object: str
    confidence: float = 1.0
    source_chunk_id: Optional[str] = None


class IngestionPipeline:
    """
    Async document ingestion pipeline.

    Processing steps:
    1. Chunk text with configurable size and overlap
    2. Extract knowledge triplets using Few-Shot LLM prompting
    3. Generate embeddings for each chunk
    4. Store in PostgreSQL (chunks, triplets) and Qdrant (vectors)
    5. Extract glossary terms via NER
    """

    def __init__(
        self,
        db_session: AsyncSession,
        llm_service: LLMService,
        chunk_size: int = 512,
        chunk_overlap: int = 50,
    ):
        self.db = db_session
        self.llm = llm_service
        self.ner = NERService()
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.qdrant = qdrant_client

    async def process_document(
        self,
        document_id: str,
        text: str,
        workspace_id: str,
        document_name: str,
        extract_graph: bool = True,
        extract_glossary: bool = True,
    ) -> Dict[str, Any]:
        """
        Process a document through the full ingestion pipeline.

        Args:
            document_id: Unique document identifier
            text: Full document text
            workspace_id: Workspace the document belongs to
            document_name: Name of the document
            extract_graph: Whether to extract knowledge triplets
            extract_glossary: Whether to extract glossary terms

        Returns:
            Processing statistics and metadata
        """
        chunks = self._chunk_text(text, document_id, workspace_id, document_name)

        tasks = [self._process_chunk_batch(chunks)]

        if extract_graph:
            tasks.append(self._extract_triplets_batch(chunks, workspace_id, document_id))

        if extract_glossary:
            tasks.append(self._extract_glossary_terms(text, workspace_id, document_id))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        chunk_result = results[0] if not isinstance(results[0], Exception) else {"error": str(results[0])}
        graph_result = results[1] if len(results) > 1 and extract_graph and not isinstance(results[1], Exception) else {}
        glossary_result = results[2] if len(results) > 2 and extract_glossary and not isinstance(results[2], Exception) else {}

        return {
            "document_id": document_id,
            "chunks_processed": len(chunks),
            "embeddings_generated": chunk_result.get("embeddings_count", 0),
            "triplets_extracted": graph_result.get("triplets_count", 0) if isinstance(graph_result, dict) else 0,
            "glossary_terms_found": glossary_result.get("terms_count", 0) if isinstance(glossary_result, dict) else 0,
            "status": "completed",
        }

    def _chunk_text(
        self,
        text: str,
        document_id: str,
        workspace_id: str,
        document_name: str,
    ) -> List[ChunkData]:
        """Split text into overlapping chunks."""
        text = text.strip()
        if not text:
            return []

        chunks = []
        start = 0
        chunk_index = 0

        while start < len(text):
            end = start + self.chunk_size

            if end < len(text):
                last_period = text.rfind('.', start, end)
                last_newline = text.rfind('\n', start, end)
                break_point = max(last_period, last_newline)

                if break_point > start + self.chunk_size // 2:
                    end = break_point + 1

            chunk_text = text[start:end].strip()

            if chunk_text:
                chunks.append(ChunkData(
                    id=str(uuid.uuid4()),
                    text=chunk_text,
                    chunk_index=chunk_index,
                    document_id=document_id,
                    workspace_id=workspace_id,
                    document_name=document_name,
                ))
                chunk_index += 1

            start = end - self.chunk_overlap

        return chunks

    async def _process_chunk_batch(
        self,
        chunks: List[ChunkData],
        batch_size: int = 10,
    ) -> Dict[str, Any]:
        """Generate embeddings and store chunks in batches."""
        total_embeddings = 0

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            texts = [c.text for c in batch]

            embeddings = await embedding_service.generate_embeddings_batch(texts)

            db_chunks = []
            qdrant_chunks = []

            for chunk, embedding in zip(batch, embeddings):
                db_chunk = Chunk(
                    id=chunk.id,
                    document_id=chunk.document_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embedding=embedding,
                )
                db_chunks.append(db_chunk)

                qdrant_chunks.append({
                    "id": chunk.id,
                    "text": chunk.text,
                    "document_id": chunk.document_id,
                    "workspace_id": chunk.workspace_id,
                    "document_name": chunk.document_name,
                    "chunk_index": chunk.chunk_index,
                })

            self.db.add_all(db_chunks)
            await self.db.flush()

            self.qdrant.upsert_chunks(qdrant_chunks, embeddings)
            total_embeddings += len(embeddings)

        await self.db.commit()

        return {"embeddings_count": total_embeddings}

    async def _extract_triplets_batch(
        self,
        chunks: List[ChunkData],
        workspace_id: str,
        document_id: str,
        max_concurrent: int = 5,
    ) -> Dict[str, Any]:
        """Extract knowledge triplets from chunks using Few-Shot LLM."""
        semaphore = asyncio.Semaphore(max_concurrent)
        all_triplets = []

        async def extract_from_chunk(chunk: ChunkData) -> List[TripletData]:
            async with semaphore:
                return await self._extract_triplets_from_text(
                    chunk.text, chunk.id
                )

        tasks = [extract_from_chunk(chunk) for chunk in chunks]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, list):
                all_triplets.extend(result)

        db_triplets = []
        for triplet in all_triplets:
            db_triplet = KnowledgeTriplet(
                id=str(uuid.uuid4()),
                workspace_id=workspace_id,
                document_id=document_id,
                subject=triplet.subject,
                relation=triplet.relation,
                object=triplet.object,
                confidence=triplet.confidence,
                source_chunk_id=triplet.source_chunk_id,
            )
            db_triplets.append(db_triplet)

        if db_triplets:
            self.db.add_all(db_triplets)
            await self.db.commit()

        return {"triplets_count": len(db_triplets)}

    async def _extract_triplets_from_text(
        self,
        text: str,
        source_chunk_id: str,
    ) -> List[TripletData]:
        """Extract triplets from a single text chunk using Few-Shot prompting."""
        if len(text) < 50:
            return []

        prompt = TRIPLET_EXTRACTION_PROMPT.format(text=text[:1000])

        try:
            response = await self.llm.generate(prompt, max_tokens=500)

            json_match = re.search(r'\[.*\]', response, re.DOTALL)
            if json_match:
                triplets_raw = json.loads(json_match.group())
            else:
                return []

            triplets = []
            for t in triplets_raw:
                if all(k in t for k in ["subject", "relation", "object"]):
                    triplets.append(TripletData(
                        subject=str(t["subject"]).strip(),
                        relation=str(t["relation"]).strip(),
                        object=str(t["object"]).strip(),
                        confidence=float(t.get("confidence", 0.8)),
                        source_chunk_id=source_chunk_id,
                    ))

            return triplets

        except (json.JSONDecodeError, Exception):
            return []

    async def _extract_glossary_terms(
        self,
        text: str,
        workspace_id: str,
        document_id: str,
    ) -> Dict[str, Any]:
        """Extract technical terms and definitions using NER."""
        entities = self.ner.extract_entities(text)

        terms_to_define = []
        for entity in entities:
            if entity["label"] in ["TECH_TERM", "ORG", "PRODUCT", "GPE", "NORP"]:
                terms_to_define.append(entity["text"])

        unique_terms = list(set(terms_to_define))[:50]

        if not unique_terms:
            return {"terms_count": 0}

        definitions = await self._generate_definitions(unique_terms, text)

        db_terms = []
        for term, definition in definitions.items():
            existing = await self.db.execute(
                select(GlossaryTerm).where(
                    GlossaryTerm.workspace_id == workspace_id,
                    GlossaryTerm.term == term,
                )
            )
            existing_term = existing.scalar_one_or_none()

            if existing_term:
                existing_term.frequency += 1
                if len(definition) > len(existing_term.definition):
                    existing_term.definition = definition
            else:
                db_terms.append(GlossaryTerm(
                    id=str(uuid.uuid4()),
                    workspace_id=workspace_id,
                    term=term,
                    definition=definition,
                    source_document_id=document_id,
                    frequency=1,
                ))

        if db_terms:
            self.db.add_all(db_terms)

        await self.db.commit()

        return {"terms_count": len(db_terms)}

    async def _generate_definitions(
        self,
        terms: List[str],
        context: str,
    ) -> Dict[str, str]:
        """Generate definitions for extracted terms using LLM."""
        prompt = f"""Based on the following document context, provide brief definitions (1-2 sentences) for these technical terms.

Context (excerpt):
{context[:2000]}

Terms to define:
{json.dumps(terms)}

Respond in JSON format:
```json
{{
    "term1": "definition1",
    "term2": "definition2"
}}
```
"""
        try:
            response = await self.llm.generate(prompt, max_tokens=800)
            json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            return json.loads(response)
        except (json.JSONDecodeError, Exception):
            return {term: f"A technical term found in the document." for term in terms}

    async def delete_document_data(self, document_id: str) -> None:
        """Remove all ingested data for a document."""
        self.qdrant.delete_document_chunks(document_id)

        await self.db.execute(
            Chunk.__table__.delete().where(Chunk.document_id == document_id)
        )
        await self.db.execute(
            KnowledgeTriplet.__table__.delete().where(KnowledgeTriplet.document_id == document_id)
        )
        await self.db.commit()
