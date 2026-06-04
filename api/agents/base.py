"""
Base classes for the Agentic RAG system.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime


class ActionType(str, Enum):
    SEARCH_VECTORS = "search_vectors"
    SEARCH_KNOWLEDGE_GRAPH = "search_knowledge_graph"
    SEARCH_WEB = "search_web"
    GENERATE_RESPONSE = "generate_response"
    DECOMPOSE_QUERY = "decompose_query"
    FINISH = "finish"


@dataclass
class AgentThought:
    """Represents a reasoning step in the ReAct loop."""
    step: int
    thought: str
    reasoning: str
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "thought": self.thought,
            "reasoning": self.reasoning,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class AgentAction:
    """Represents an action taken by the agent."""
    step: int
    action_type: ActionType
    action_input: Dict[str, Any]
    result: Optional[Any] = None
    success: bool = True
    error: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step": self.step,
            "action_type": self.action_type.value,
            "action_input": self.action_input,
            "result": str(self.result)[:500] if self.result else None,
            "success": self.success,
            "error": self.error,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class AgentState:
    """Current state of the agent during execution."""
    original_query: str
    current_query: str
    sub_queries: List[str] = field(default_factory=list)
    thoughts: List[AgentThought] = field(default_factory=list)
    actions: List[AgentAction] = field(default_factory=list)
    retrieved_context: List[Dict[str, Any]] = field(default_factory=list)
    graph_context: List[Dict[str, Any]] = field(default_factory=list)
    web_context: List[Dict[str, Any]] = field(default_factory=list)
    iteration: int = 0
    is_complete: bool = False
    final_answer: Optional[str] = None
    glossary_injections: List[Dict[str, str]] = field(default_factory=list)

    def add_thought(self, thought: str, reasoning: str) -> None:
        self.thoughts.append(AgentThought(
            step=len(self.thoughts) + 1,
            thought=thought,
            reasoning=reasoning,
        ))

    def add_action(self, action_type: ActionType, action_input: Dict[str, Any]) -> AgentAction:
        action = AgentAction(
            step=len(self.actions) + 1,
            action_type=action_type,
            action_input=action_input,
        )
        self.actions.append(action)
        return action

    def get_reasoning_trace(self) -> Dict[str, Any]:
        return {
            "original_query": self.original_query,
            "sub_queries": self.sub_queries,
            "iterations": self.iteration,
            "thoughts": [t.to_dict() for t in self.thoughts],
            "actions": [a.to_dict() for a in self.actions],
            "context_sources": {
                "vector_results": len(self.retrieved_context),
                "graph_results": len(self.graph_context),
                "web_results": len(self.web_context),
            },
            "glossary_terms_injected": len(self.glossary_injections),
        }


class BaseTool(ABC):
    """Abstract base class for agent tools."""

    name: str
    description: str

    @abstractmethod
    async def execute(self, **kwargs) -> Any:
        """Execute the tool with given parameters."""
        pass

    def get_schema(self) -> Dict[str, Any]:
        """Return the tool's input schema for the LLM."""
        return {
            "name": self.name,
            "description": self.description,
        }
