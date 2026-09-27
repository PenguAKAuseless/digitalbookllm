"""
Knowledge Graph Tool for querying extracted triplets.
"""
from typing import List, Dict, Any, Optional
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from agents.base import BaseTool
from database.models import KnowledgeTriplet


class KnowledgeGraphTool(BaseTool):
    """Tool for querying knowledge graph triplets extracted from documents."""

    name = "knowledge_graph"
    description = """Query the knowledge graph to find relationships between entities.
    Use this tool when you need to understand how concepts are related to each other.
    Input should be an entity name or relationship query."""

    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def execute(
        self,
        query: str,
        workspace_id: str,
        entity_type: str = "any",
        max_results: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Query knowledge graph for related triplets.

        Args:
            query: Entity or concept to search for
            workspace_id: ID of the workspace
            entity_type: 'subject', 'object', or 'any' (searches both)
            max_results: Maximum number of triplets to return

        Returns:
            List of knowledge triplets with relationships
        """
        query_lower = query.lower()

        if entity_type == "subject":
            stmt = select(KnowledgeTriplet).where(
                KnowledgeTriplet.workspace_id == workspace_id,
                func.lower(KnowledgeTriplet.subject).contains(query_lower),
            ).limit(max_results)
        elif entity_type == "object":
            stmt = select(KnowledgeTriplet).where(
                KnowledgeTriplet.workspace_id == workspace_id,
                func.lower(KnowledgeTriplet.object).contains(query_lower),
            ).limit(max_results)
        else:
            stmt = select(KnowledgeTriplet).where(
                KnowledgeTriplet.workspace_id == workspace_id,
                or_(
                    func.lower(KnowledgeTriplet.subject).contains(query_lower),
                    func.lower(KnowledgeTriplet.object).contains(query_lower),
                    func.lower(KnowledgeTriplet.relation).contains(query_lower),
                ),
            ).limit(max_results)

        result = await self.db.execute(stmt)
        triplets = result.scalars().all()

        return [
            {
                "id": t.id,
                "subject": t.subject,
                "relation": t.relation,
                "object": t.object,
                "confidence": t.confidence,
                "document_id": t.document_id,
            }
            for t in triplets
        ]

    async def get_entity_graph(
        self,
        entity: str,
        workspace_id: str,
        depth: int = 2,
    ) -> Dict[str, Any]:
        """
        Get a subgraph around an entity up to specified depth.

        Returns nodes and edges for force-directed visualization.
        """
        nodes = {}
        edges = []
        visited_entities = set()
        current_entities = [entity.lower()]

        for _ in range(depth):
            if not current_entities:
                break

            next_entities = []

            for current_entity in current_entities:
                if current_entity in visited_entities:
                    continue
                visited_entities.add(current_entity)

                stmt = select(KnowledgeTriplet).where(
                    KnowledgeTriplet.workspace_id == workspace_id,
                    or_(
                        func.lower(KnowledgeTriplet.subject).contains(current_entity),
                        func.lower(KnowledgeTriplet.object).contains(current_entity),
                    ),
                ).limit(50)

                result = await self.db.execute(stmt)
                triplets = result.scalars().all()

                for t in triplets:
                    if t.subject not in nodes:
                        nodes[t.subject] = {
                            "id": t.subject,
                            "label": t.subject,
                            "type": "entity",
                        }
                    if t.object not in nodes:
                        nodes[t.object] = {
                            "id": t.object,
                            "label": t.object,
                            "type": "entity",
                        }

                    edges.append({
                        "source": t.subject,
                        "target": t.object,
                        "relation": t.relation,
                        "confidence": t.confidence,
                    })

                    if t.subject.lower() not in visited_entities:
                        next_entities.append(t.subject.lower())
                    if t.object.lower() not in visited_entities:
                        next_entities.append(t.object.lower())

            current_entities = list(set(next_entities))

        return {
            "nodes": list(nodes.values()),
            "edges": edges,
        }

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Entity or concept to search for in the knowledge graph",
                    },
                    "entity_type": {
                        "type": "string",
                        "enum": ["subject", "object", "any"],
                        "description": "Type of search: 'subject', 'object', or 'any'",
                        "default": "any",
                    },
                },
                "required": ["query"],
            },
        }
