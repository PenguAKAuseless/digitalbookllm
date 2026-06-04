"""
Dynamic Glossary Manager for technical term extraction and query enrichment.

Implements:
1. Extraction: NER-based term detection during document ingestion
2. Query Pre-processing: Inject definitions into LLM system prompts
3. API: Fast lookup endpoint for frontend tooltips
"""
from typing import List, Dict, Any, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import GlossaryTerm
from services.ner_service import NERService


class DynamicGlossaryManager:
    """
    Manages the dynamic glossary for technical term definitions.

    Key Features:
    - Extract and store technical terms from documents
    - Enrich user queries with term definitions
    - Provide fast lookup API for frontend tooltips
    """

    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self.ner = NERService()

    async def enrich_query_with_definitions(
        self,
        query: str,
        workspace_id: str,
        max_terms: int = 5,
    ) -> List[Dict[str, str]]:
        """
        Intercept a user query and inject glossary term definitions.

        This is called BEFORE the query is sent to the Agentic RAG loop
        to prevent hallucinations by providing explicit definitions.

        Args:
            query: User's original query
            workspace_id: Workspace to look up terms from
            max_terms: Maximum number of terms to inject

        Returns:
            List of term definitions to inject into the system prompt
        """
        entities = self.ner.extract_entities(query)
        query_terms = [e["text"].lower() for e in entities]

        query_words = set(query.lower().split())

        terms_to_lookup = list(set(query_terms) | query_words)

        stmt = select(GlossaryTerm).where(
            GlossaryTerm.workspace_id == workspace_id,
            func.lower(GlossaryTerm.term).in_(terms_to_lookup),
        ).order_by(
            GlossaryTerm.frequency.desc()
        ).limit(max_terms)

        result = await self.db.execute(stmt)
        glossary_terms = result.scalars().all()

        return [
            {
                "term": t.term,
                "definition": t.definition,
                "category": t.category,
            }
            for t in glossary_terms
        ]

    async def lookup_terms(
        self,
        terms: List[str],
        workspace_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Fast lookup for multiple terms (used by frontend for tooltips).

        Args:
            terms: List of terms to look up
            workspace_id: Workspace context

        Returns:
            List of matching term definitions
        """
        terms_lower = [t.lower() for t in terms]

        stmt = select(GlossaryTerm).where(
            GlossaryTerm.workspace_id == workspace_id,
            func.lower(GlossaryTerm.term).in_(terms_lower),
        )

        result = await self.db.execute(stmt)
        glossary_terms = result.scalars().all()

        return [
            {
                "id": t.id,
                "term": t.term,
                "definition": t.definition,
                "category": t.category,
                "frequency": t.frequency,
            }
            for t in glossary_terms
        ]

    async def search_terms(
        self,
        query: str,
        workspace_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Search glossary terms by partial match.

        Args:
            query: Search query string
            workspace_id: Workspace context
            limit: Maximum results

        Returns:
            Matching terms with definitions
        """
        stmt = select(GlossaryTerm).where(
            GlossaryTerm.workspace_id == workspace_id,
            func.lower(GlossaryTerm.term).contains(query.lower()),
        ).order_by(
            GlossaryTerm.frequency.desc()
        ).limit(limit)

        result = await self.db.execute(stmt)
        glossary_terms = result.scalars().all()

        return [
            {
                "id": t.id,
                "term": t.term,
                "definition": t.definition,
                "category": t.category,
                "frequency": t.frequency,
            }
            for t in glossary_terms
        ]

    async def get_all_terms(
        self,
        workspace_id: str,
        page: int = 1,
        page_size: int = 50,
    ) -> Dict[str, Any]:
        """
        Get all glossary terms for a workspace with pagination.

        Args:
            workspace_id: Workspace context
            page: Page number (1-indexed)
            page_size: Number of items per page

        Returns:
            Paginated list of terms with metadata
        """
        count_stmt = select(func.count(GlossaryTerm.id)).where(
            GlossaryTerm.workspace_id == workspace_id
        )
        total_result = await self.db.execute(count_stmt)
        total_count = total_result.scalar()

        offset = (page - 1) * page_size
        stmt = select(GlossaryTerm).where(
            GlossaryTerm.workspace_id == workspace_id
        ).order_by(
            GlossaryTerm.term
        ).offset(offset).limit(page_size)

        result = await self.db.execute(stmt)
        glossary_terms = result.scalars().all()

        return {
            "terms": [
                {
                    "id": t.id,
                    "term": t.term,
                    "definition": t.definition,
                    "category": t.category,
                    "frequency": t.frequency,
                }
                for t in glossary_terms
            ],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_count": total_count,
                "total_pages": (total_count + page_size - 1) // page_size,
            },
        }

    async def add_term(
        self,
        workspace_id: str,
        term: str,
        definition: str,
        category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Manually add a glossary term."""
        import uuid

        existing = await self.db.execute(
            select(GlossaryTerm).where(
                GlossaryTerm.workspace_id == workspace_id,
                func.lower(GlossaryTerm.term) == term.lower(),
            )
        )
        existing_term = existing.scalar_one_or_none()

        if existing_term:
            existing_term.definition = definition
            if category:
                existing_term.category = category
            await self.db.commit()
            return {
                "id": existing_term.id,
                "term": existing_term.term,
                "definition": existing_term.definition,
                "updated": True,
            }

        new_term = GlossaryTerm(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            term=term,
            definition=definition,
            category=category,
            frequency=1,
        )
        self.db.add(new_term)
        await self.db.commit()

        return {
            "id": new_term.id,
            "term": new_term.term,
            "definition": new_term.definition,
            "created": True,
        }

    async def delete_term(self, term_id: str, workspace_id: str) -> bool:
        """Delete a glossary term."""
        result = await self.db.execute(
            select(GlossaryTerm).where(
                GlossaryTerm.id == term_id,
                GlossaryTerm.workspace_id == workspace_id,
            )
        )
        term = result.scalar_one_or_none()

        if not term:
            return False

        await self.db.delete(term)
        await self.db.commit()
        return True

    def build_glossary_prompt_injection(
        self,
        terms: List[Dict[str, str]],
    ) -> str:
        """
        Build a prompt injection string from glossary terms.

        This is injected into the LLM system prompt to ensure
        consistent and accurate use of technical terminology.
        """
        if not terms:
            return ""

        lines = ["## Domain-Specific Terminology (Use these definitions for accuracy)"]
        for t in terms:
            category_tag = f" [{t.get('category', 'term')}]" if t.get('category') else ""
            lines.append(f"- **{t['term']}**{category_tag}: {t['definition']}")

        return "\n".join(lines)
