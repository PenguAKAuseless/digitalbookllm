"""
Dynamic LoRA Adapter Router for domain-specific model adaptation.
Routes to appropriate LoRA weights based on workspace domain.
"""
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from pathlib import Path
import os

from config import settings


@dataclass
class LoRAAdapter:
    """Represents a LoRA adapter configuration."""
    name: str
    domain: str
    path: str
    description: str
    rank: int = 8
    alpha: float = 16.0
    target_modules: List[str] = None

    def __post_init__(self):
        if self.target_modules is None:
            self.target_modules = ["q_proj", "v_proj", "k_proj", "o_proj"]


class LoRARouter:
    """
    Routes requests to appropriate LoRA adapters based on workspace domain.

    Domain examples:
    - 'medical': Medical/healthcare documents
    - 'legal': Legal documents and contracts
    - 'technical': Technical documentation, code
    - 'academic': Research papers, academic texts
    - 'general': Default adapter for mixed content
    """

    DOMAIN_MAPPING = {
        "medical": ["medical", "healthcare", "clinical", "pharmaceutical", "biology"],
        "legal": ["legal", "law", "contract", "compliance", "regulatory"],
        "technical": ["technical", "engineering", "software", "it", "programming"],
        "academic": ["academic", "research", "scientific", "education"],
        "financial": ["financial", "finance", "accounting", "banking", "investment"],
    }

    def __init__(self):
        self.adapters_path = Path(settings.LORA_ADAPTERS_PATH)
        self.adapters: Dict[str, LoRAAdapter] = {}
        self._load_adapters()

    def _load_adapters(self) -> None:
        """Load available LoRA adapters from the adapters directory."""
        self.adapters["general"] = LoRAAdapter(
            name="general",
            domain="general",
            path=str(self.adapters_path / "general"),
            description="General-purpose adapter for mixed content",
        )

        if not self.adapters_path.exists():
            self.adapters_path.mkdir(parents=True, exist_ok=True)
            return

        for domain_dir in self.adapters_path.iterdir():
            if domain_dir.is_dir() and domain_dir.name != "general":
                adapter_config = domain_dir / "adapter_config.json"
                if adapter_config.exists():
                    self.adapters[domain_dir.name] = LoRAAdapter(
                        name=domain_dir.name,
                        domain=domain_dir.name,
                        path=str(domain_dir),
                        description=f"LoRA adapter for {domain_dir.name} domain",
                    )

    def get_adapter_for_domain(self, domain: Optional[str]) -> LoRAAdapter:
        """
        Get the appropriate LoRA adapter for a given domain.

        Args:
            domain: The workspace domain (e.g., 'medical', 'legal')

        Returns:
            The matching LoRA adapter or the general adapter
        """
        if not domain:
            return self.adapters.get("general", self.adapters["general"])

        domain_lower = domain.lower()

        if domain_lower in self.adapters:
            return self.adapters[domain_lower]

        for adapter_domain, keywords in self.DOMAIN_MAPPING.items():
            if domain_lower in keywords or any(kw in domain_lower for kw in keywords):
                if adapter_domain in self.adapters:
                    return self.adapters[adapter_domain]

        return self.adapters.get("general", self.adapters["general"])

    def detect_domain_from_content(self, content: str) -> str:
        """
        Automatically detect domain from document content using keyword analysis.

        Args:
            content: Document text content

        Returns:
            Detected domain string
        """
        content_lower = content.lower()

        domain_scores = {}
        for domain, keywords in self.DOMAIN_MAPPING.items():
            score = sum(1 for kw in keywords if kw in content_lower)
            if score > 0:
                domain_scores[domain] = score

        if domain_scores:
            return max(domain_scores, key=domain_scores.get)

        return "general"

    def list_available_adapters(self) -> List[Dict[str, Any]]:
        """List all available LoRA adapters."""
        return [
            {
                "name": adapter.name,
                "domain": adapter.domain,
                "description": adapter.description,
                "path": adapter.path,
                "available": Path(adapter.path).exists(),
            }
            for adapter in self.adapters.values()
        ]

    def get_adapter_config(self, domain: str) -> Dict[str, Any]:
        """Get configuration for loading a specific adapter."""
        adapter = self.get_adapter_for_domain(domain)
        return {
            "adapter_name": adapter.name,
            "adapter_path": adapter.path,
            "r": adapter.rank,
            "lora_alpha": adapter.alpha,
            "target_modules": adapter.target_modules,
            "bias": "none",
            "task_type": "CAUSAL_LM",
        }


lora_router = LoRARouter()
