"""
Agentic RAG Manager implementing the ReAct (Reasoning + Acting) paradigm.

This is NOT a passive RAG system. It implements:
1. Planning: Break down complex queries into sub-queries
2. Reasoning: Think about what information is needed
3. Action: Execute tools (Vector Search, Knowledge Graph, Web Search)
4. Observation: Analyze results and decide next steps

CRITICAL: Hard-limit counter prevents infinite loops (max 5 iterations).
"""
import json
import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from agents.base import AgentState, AgentAction, AgentThought, ActionType
from agents.tools.vector_search import VectorSearchTool
from agents.tools.knowledge_graph import KnowledgeGraphTool
from agents.tools.web_search import WebSearchTool
from services.llm_service import LLMService
from pipelines.glossary import DynamicGlossaryManager


PLANNING_PROMPT = """You are an intelligent research assistant. Your task is to analyze the user's question and create a plan to answer it.

## User Question
{query}

## Available Tools
1. **vector_search**: Search through uploaded documents using semantic similarity
2. **knowledge_graph**: Query relationships between entities extracted from documents
3. **web_search**: Search the web for external information (use sparingly)

## Instructions
Analyze the question and decide:
1. Is this a simple question that can be answered with one search, or complex requiring multiple steps?
2. What sub-questions need to be answered?
3. Which tools should be used and in what order?

Respond in JSON format:
```json
{{
    "complexity": "simple|complex",
    "sub_queries": ["sub-question 1", "sub-question 2"],
    "plan": [
        {{"step": 1, "tool": "tool_name", "query": "search query", "reason": "why this step"}}
    ],
    "requires_web_search": true|false
}}
```
"""

REASONING_PROMPT = """You are an intelligent research assistant in a ReAct loop.

## Original Question
{original_query}

## Current Sub-Query
{current_query}

## Glossary Context (Domain Terms)
{glossary_context}

## Retrieved Information So Far
{context}

## Previous Reasoning Steps
{previous_thoughts}

## Current Iteration
{iteration} of {max_iterations}

## Instructions
Based on the information gathered, decide your next action:

1. **THINK**: What do you know? What's missing?
2. **ACT**: Choose ONE action:
   - `search_vectors`: Search documents for more information
   - `search_knowledge_graph`: Find entity relationships
   - `search_web`: Search web (only if documents lack info)
   - `finish`: You have enough information to answer

Respond in JSON format:
```json
{{
    "thought": "Your reasoning about the current state",
    "action": "action_name",
    "action_input": {{"query": "your search query"}},
    "confidence": 0.0-1.0,
    "reasoning": "Why you chose this action"
}}
```

If action is "finish", include:
```json
{{
    "thought": "I have enough information to answer",
    "action": "finish",
    "action_input": {{}},
    "confidence": 0.95,
    "reasoning": "The retrieved context contains the answer"
}}
```
"""

GENERATION_PROMPT = """You are a helpful academic assistant. Answer the user's question based on the provided context.

## User Question
{query}

## Glossary Terms (Use these definitions for accuracy)
{glossary_context}

## Document Context
{document_context}

## Knowledge Graph Context
{graph_context}

## Web Search Context (External Sources)
{web_context}

## Instructions
1. Answer based primarily on the Document Context
2. Use Glossary Terms to ensure technical accuracy
3. Use Knowledge Graph to explain relationships
4. Only cite Web Context if explicitly needed
5. If information is insufficient, say so clearly
6. Be concise and educational

## Response Format
Provide a clear, structured answer. If citing sources, mention document names.
"""


class AgenticRAGManager:
    """
    Agentic RAG Manager implementing Planning → Reasoning → Action loop.

    Key Features:
    - Sub-query decomposition for complex questions
    - Multi-tool orchestration (Vector, Graph, Web)
    - Hard iteration limit to prevent infinite loops
    - Glossary-aware context injection
    - Full reasoning trace for transparency
    """

    def __init__(
        self,
        db_session: AsyncSession,
        llm_service: LLMService,
        glossary_manager: DynamicGlossaryManager,
    ):
        self.db = db_session
        self.llm = llm_service
        self.glossary = glossary_manager
        self.max_iterations = settings.MAX_RAG_ITERATIONS
        self.max_sub_queries = settings.MAX_SUB_QUERIES

        self.vector_tool = VectorSearchTool()
        self.graph_tool = KnowledgeGraphTool(db_session)
        self.web_tool = WebSearchTool()

    async def process_query(
        self,
        query: str,
        workspace_id: str,
        document_id: Optional[str] = None,
        selected_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point for processing a user query through the Agentic RAG pipeline.

        Args:
            query: User's question
            workspace_id: ID of the workspace to search
            document_id: Optional specific document to focus on
            selected_text: Optional text the user selected (higher priority context)

        Returns:
            Dict with response, reasoning trace, and metadata
        """
        state = AgentState(
            original_query=query,
            current_query=query,
        )

        glossary_terms = await self.glossary.enrich_query_with_definitions(
            query, workspace_id
        )
        state.glossary_injections = glossary_terms

        if selected_text:
            state.retrieved_context.append({
                "text": selected_text,
                "source": "user_selection",
                "similarity": 1.0,
            })

        plan = await self._create_plan(query, state)
        state.sub_queries = plan.get("sub_queries", [query])[:self.max_sub_queries]

        for sub_query in state.sub_queries:
            state.current_query = sub_query
            await self._execute_react_loop(state, workspace_id, document_id)

            if state.iteration >= self.max_iterations:
                state.add_thought(
                    thought="Maximum iterations reached",
                    reasoning=f"Safety limit of {self.max_iterations} iterations hit. Proceeding to generate response.",
                )
                break

        response = await self._generate_final_response(state)
        state.final_answer = response
        state.is_complete = True

        return {
            "response": response,
            "reasoning_trace": state.get_reasoning_trace(),
            "sub_queries": state.sub_queries,
            "sources": {
                "documents": len(state.retrieved_context),
                "graph": len(state.graph_context),
                "web": len(state.web_context),
            },
            "iterations": state.iteration,
            "glossary_terms": state.glossary_injections,
        }

    async def _create_plan(self, query: str, state: AgentState) -> Dict[str, Any]:
        """Create an execution plan by analyzing the query complexity."""
        prompt = PLANNING_PROMPT.format(query=query)

        try:
            response = await self.llm.generate(prompt, max_tokens=500)
            json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
            if json_match:
                plan = json.loads(json_match.group(1))
            else:
                plan = json.loads(response)

            state.add_thought(
                thought=f"Query analyzed as {plan.get('complexity', 'simple')}",
                reasoning=f"Created plan with {len(plan.get('sub_queries', []))} sub-queries",
            )
            return plan

        except (json.JSONDecodeError, Exception) as e:
            state.add_thought(
                thought="Using simple query plan",
                reasoning=f"Could not parse complex plan: {str(e)}",
            )
            return {"complexity": "simple", "sub_queries": [query]}

    async def _execute_react_loop(
        self,
        state: AgentState,
        workspace_id: str,
        document_id: Optional[str],
    ) -> None:
        """
        Execute the ReAct loop for a single sub-query.

        CRITICAL: Hard iteration limit enforced here.
        """
        iteration_start = state.iteration

        while state.iteration < self.max_iterations:
            state.iteration += 1

            thought, action, action_input = await self._reason(state)

            if thought:
                state.add_thought(thought=thought, reasoning=action_input.get("reasoning", ""))

            if action == ActionType.FINISH:
                break

            result = await self._execute_action(
                action, action_input, state, workspace_id, document_id
            )

            action_record = state.add_action(action, action_input)
            action_record.result = result

            if state.iteration - iteration_start >= 3:
                state.add_thought(
                    thought=f"Sub-query iteration limit reached",
                    reasoning="Moving to next sub-query or final generation",
                )
                break

    async def _reason(self, state: AgentState) -> Tuple[str, ActionType, Dict[str, Any]]:
        """Reasoning step: decide what action to take next."""
        context_summary = self._summarize_context(state)
        previous_thoughts = "\n".join([
            f"Step {t.step}: {t.thought}" for t in state.thoughts[-3:]
        ])

        glossary_context = "\n".join([
            f"- **{g['term']}**: {g['definition']}"
            for g in state.glossary_injections
        ]) or "No glossary terms found."

        prompt = REASONING_PROMPT.format(
            original_query=state.original_query,
            current_query=state.current_query,
            glossary_context=glossary_context,
            context=context_summary,
            previous_thoughts=previous_thoughts or "None yet.",
            iteration=state.iteration,
            max_iterations=self.max_iterations,
        )

        try:
            response = await self.llm.generate(prompt, max_tokens=400)
            json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
            if json_match:
                decision = json.loads(json_match.group(1))
            else:
                decision = json.loads(response)

            action_str = decision.get("action", "finish")
            action_map = {
                "search_vectors": ActionType.SEARCH_VECTORS,
                "search_knowledge_graph": ActionType.SEARCH_KNOWLEDGE_GRAPH,
                "search_web": ActionType.SEARCH_WEB,
                "finish": ActionType.FINISH,
            }
            action = action_map.get(action_str, ActionType.FINISH)

            return (
                decision.get("thought", ""),
                action,
                decision.get("action_input", {}),
            )

        except (json.JSONDecodeError, Exception):
            if len(state.retrieved_context) > 0:
                return ("Parsing failed, using collected context", ActionType.FINISH, {})
            return ("Parsing failed, searching documents", ActionType.SEARCH_VECTORS, {"query": state.current_query})

    async def _execute_action(
        self,
        action: ActionType,
        action_input: Dict[str, Any],
        state: AgentState,
        workspace_id: str,
        document_id: Optional[str],
    ) -> Any:
        """Execute the chosen action and store results."""
        query = action_input.get("query", state.current_query)

        if action == ActionType.SEARCH_VECTORS:
            results = await self.vector_tool.execute(
                query=query,
                workspace_id=workspace_id,
                document_id=document_id,
                top_k=settings.RETRIEVAL_TOP_K,
                score_threshold=settings.SIMILARITY_THRESHOLD,
            )
            state.retrieved_context.extend(results)
            return results

        elif action == ActionType.SEARCH_KNOWLEDGE_GRAPH:
            results = await self.graph_tool.execute(
                query=query,
                workspace_id=workspace_id,
            )
            state.graph_context.extend(results)
            return results

        elif action == ActionType.SEARCH_WEB:
            results = await self.web_tool.execute(
                query=query,
                max_results=3,
            )
            state.web_context.extend(results)
            return results

        return None

    def _summarize_context(self, state: AgentState) -> str:
        """Summarize collected context for the reasoning prompt."""
        parts = []

        if state.retrieved_context:
            doc_summary = "\n".join([
                f"- [{c.get('document_name', 'Document')}]: {c.get('text', '')[:200]}..."
                for c in state.retrieved_context[:5]
            ])
            parts.append(f"**Documents ({len(state.retrieved_context)} chunks)**:\n{doc_summary}")

        if state.graph_context:
            graph_summary = "\n".join([
                f"- {t['subject']} --[{t['relation']}]--> {t['object']}"
                for t in state.graph_context[:5]
            ])
            parts.append(f"**Knowledge Graph ({len(state.graph_context)} triplets)**:\n{graph_summary}")

        if state.web_context:
            web_summary = "\n".join([
                f"- [{w.get('title', 'Web')}]: {w.get('snippet', '')[:150]}..."
                for w in state.web_context[:3]
            ])
            parts.append(f"**Web Results ({len(state.web_context)} results)**:\n{web_summary}")

        return "\n\n".join(parts) if parts else "No context collected yet."

    async def _generate_final_response(self, state: AgentState) -> str:
        """Generate the final response using all collected context."""
        glossary_context = "\n".join([
            f"- **{g['term']}**: {g['definition']}"
            for g in state.glossary_injections
        ]) or "No specific terms."

        document_context = "\n\n".join([
            f"[{c.get('document_name', 'Document')}]: {c.get('text', '')}"
            for c in state.retrieved_context[:10]
        ]) or "No document context available."

        graph_context = "\n".join([
            f"- {t['subject']} --[{t['relation']}]--> {t['object']}"
            for t in state.graph_context[:10]
        ]) or "No graph relationships found."

        web_context = "\n".join([
            f"- [{w.get('title', 'Source')}]({w.get('link', '')}): {w.get('snippet', '')}"
            for w in state.web_context[:5]
        ]) or "No web sources used."

        prompt = GENERATION_PROMPT.format(
            query=state.original_query,
            glossary_context=glossary_context,
            document_context=document_context,
            graph_context=graph_context,
            web_context=web_context,
        )

        response = await self.llm.generate(prompt, max_tokens=800)
        return response
