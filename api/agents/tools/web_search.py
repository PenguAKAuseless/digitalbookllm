"""
Web Search Tool using DuckDuckGo for external information retrieval.
"""
from typing import List, Dict, Any
from duckduckgo_search import DDGS

from agents.base import BaseTool


class WebSearchTool(BaseTool):
    """Tool for searching the web when local documents don't have sufficient information."""

    name = "web_search"
    description = """Search the web for additional information not found in local documents.
    Use this tool sparingly, only when the user's documents don't contain the answer
    and the question requires external knowledge.
    Input should be a search query string."""

    def __init__(self):
        self.ddgs = DDGS()

    async def execute(
        self,
        query: str,
        max_results: int = 5,
        region: str = "wt-wt",
    ) -> List[Dict[str, Any]]:
        """
        Execute web search using DuckDuckGo.

        Args:
            query: Search query string
            max_results: Maximum number of results to return
            region: Region for search (default: worldwide)

        Returns:
            List of search results with title, link, and snippet
        """
        try:
            results = list(self.ddgs.text(
                query,
                max_results=max_results,
                region=region,
            ))

            return [
                {
                    "title": r.get("title", ""),
                    "link": r.get("href", ""),
                    "snippet": r.get("body", ""),
                    "source": "web",
                }
                for r in results
            ]
        except Exception as e:
            return [{
                "error": str(e),
                "message": "Web search temporarily unavailable",
            }]

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to find information on the web",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results (default: 5)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        }
