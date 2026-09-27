"""
Graph Router - Knowledge Graph visualization API.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional

from database import get_db
from database.models import KnowledgeTriplet
from agents.tools.knowledge_graph import KnowledgeGraphTool

router = APIRouter(prefix="/graph", tags=["Knowledge Graph"])


@router.get("/triplets")
async def get_triplets(
    workspace_id: str = Query(..., description="Workspace ID"),
    document_id: Optional[str] = Query(None, description="Filter by document"),
    subject: Optional[str] = Query(None, description="Filter by subject"),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    Get knowledge triplets for visualization.

    Returns triplets in a format suitable for force-directed graph rendering.
    """
    stmt = select(KnowledgeTriplet).where(
        KnowledgeTriplet.workspace_id == workspace_id
    )

    if document_id:
        stmt = stmt.where(KnowledgeTriplet.document_id == document_id)

    if subject:
        stmt = stmt.where(
            func.lower(KnowledgeTriplet.subject).contains(subject.lower())
        )

    stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    triplets = result.scalars().all()

    nodes = {}
    edges = []

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
            "id": t.id,
            "source": t.subject,
            "target": t.object,
            "relation": t.relation,
            "confidence": t.confidence,
        })

    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "total_triplets": len(triplets),
    }


@router.get("/entity/{entity}")
async def get_entity_graph(
    entity: str,
    workspace_id: str = Query(..., description="Workspace ID"),
    depth: int = Query(2, ge=1, le=3, description="Graph traversal depth"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a subgraph around a specific entity.

    Returns nodes and edges within the specified depth from the entity.
    Useful for exploring relationships around a concept.
    """
    graph_tool = KnowledgeGraphTool(db)
    result = await graph_tool.get_entity_graph(
        entity=entity,
        workspace_id=workspace_id,
        depth=depth,
    )
    return result


@router.get("/stats")
async def get_graph_stats(
    workspace_id: str = Query(..., description="Workspace ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get statistics about the knowledge graph.
    """
    triplet_count = await db.execute(
        select(func.count(KnowledgeTriplet.id)).where(
            KnowledgeTriplet.workspace_id == workspace_id
        )
    )

    unique_subjects = await db.execute(
        select(func.count(func.distinct(KnowledgeTriplet.subject))).where(
            KnowledgeTriplet.workspace_id == workspace_id
        )
    )

    unique_relations = await db.execute(
        select(func.count(func.distinct(KnowledgeTriplet.relation))).where(
            KnowledgeTriplet.workspace_id == workspace_id
        )
    )

    top_subjects = await db.execute(
        select(
            KnowledgeTriplet.subject,
            func.count(KnowledgeTriplet.id).label("count")
        ).where(
            KnowledgeTriplet.workspace_id == workspace_id
        ).group_by(
            KnowledgeTriplet.subject
        ).order_by(
            func.count(KnowledgeTriplet.id).desc()
        ).limit(10)
    )

    return {
        "total_triplets": triplet_count.scalar(),
        "unique_entities": unique_subjects.scalar(),
        "unique_relations": unique_relations.scalar(),
        "top_entities": [
            {"entity": row.subject, "count": row.count}
            for row in top_subjects.all()
        ],
    }
