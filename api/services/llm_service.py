"""
LLM Service with multi-provider support and LoRA adapter routing.

Providers (in priority order):
1. Together AI
2. OpenAI
3. Anthropic
4. Groq
5. Ollama (local)
6. HuggingFace Transformers (local, with optional LoRA)
"""
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
import asyncio
import httpx

from config import settings
from agents.lora_router import lora_router, LoRAAdapter


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    name: str

    @abstractmethod
    def is_available(self) -> bool:
        pass

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs,
    ) -> str:
        pass


class TogetherAIProvider(LLMProvider):
    name = "Together AI"

    def is_available(self) -> bool:
        key = settings.TOGETHER_API_KEY or ""
        return len(key) > 0 and key != "your_together_api_key_here"

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs,
    ) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.together.xyz/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.TOGETHER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]


class OpenAIProvider(LLMProvider):
    name = "OpenAI"

    def is_available(self) -> bool:
        key = settings.OPENAI_API_KEY or ""
        return len(key) > 0 and key != "your_openai_api_key_here"

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs,
    ) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]


class AnthropicProvider(LLMProvider):
    name = "Anthropic"

    def is_available(self) -> bool:
        key = settings.ANTHROPIC_API_KEY or ""
        return len(key) > 0 and key != "your_anthropic_api_key_here"

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs,
    ) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            return response.json()["content"][0]["text"]


class GroqProvider(LLMProvider):
    name = "Groq"

    def is_available(self) -> bool:
        key = settings.GROQ_API_KEY or ""
        return len(key) > 0 and key != "your_groq_api_key_here"

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs,
    ) -> str:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]


class OllamaProvider(LLMProvider):
    name = "Ollama"

    def is_available(self) -> bool:
        return bool(settings.OLLAMA_URL and settings.OLLAMA_URL.strip())

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        **kwargs,
    ) -> str:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{settings.OLLAMA_URL}/api/generate",
                json={
                    "model": "llama3.2",
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "num_predict": max_tokens,
                        "temperature": temperature,
                    },
                },
            )
            response.raise_for_status()
            return response.json()["response"]


class LocalHuggingFaceProvider(LLMProvider):
    """Local HuggingFace model with optional LoRA adapter support."""

    name = "Local (HuggingFace)"

    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._current_adapter: Optional[str] = None

    def is_available(self) -> bool:
        return True

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        domain: Optional[str] = None,
        **kwargs,
    ) -> str:
        return await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self._generate_sync(prompt, max_tokens, temperature, domain),
        )

    def _generate_sync(
        self,
        prompt: str,
        max_tokens: int,
        temperature: float,
        domain: Optional[str],
    ) -> str:
        self._ensure_model_loaded(domain)

        inputs = self._tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
        inputs = {k: v.to(self._model.device) for k, v in inputs.items()}

        outputs = self._model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=temperature,
            do_sample=temperature > 0,
            pad_token_id=self._tokenizer.eos_token_id,
        )

        response = self._tokenizer.decode(outputs[0], skip_special_tokens=True)
        return response[len(prompt):].strip()

    def _ensure_model_loaded(self, domain: Optional[str] = None) -> None:
        """Lazy-load model and switch LoRA adapters as needed."""
        if self._model is None:
            from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
            import torch

            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
            )

            self._tokenizer = AutoTokenizer.from_pretrained(settings.BASE_LLM_MODEL)
            self._model = AutoModelForCausalLM.from_pretrained(
                settings.BASE_LLM_MODEL,
                quantization_config=bnb_config,
                device_map="auto",
                trust_remote_code=True,
            )

        adapter = lora_router.get_adapter_for_domain(domain)
        if adapter.name != self._current_adapter:
            self._switch_lora_adapter(adapter)

    def _switch_lora_adapter(self, adapter: LoRAAdapter) -> None:
        """Switch to a different LoRA adapter."""
        from pathlib import Path

        adapter_path = Path(adapter.path)
        if adapter_path.exists() and (adapter_path / "adapter_config.json").exists():
            try:
                from peft import PeftModel

                if hasattr(self._model, "disable_adapter"):
                    self._model.disable_adapter()

                self._model = PeftModel.from_pretrained(
                    self._model,
                    adapter.path,
                    adapter_name=adapter.name,
                )
                self._current_adapter = adapter.name
                print(f"[LLM] Switched to LoRA adapter: {adapter.name}")
            except Exception as e:
                print(f"[LLM] Failed to load LoRA adapter {adapter.name}: {e}")
        else:
            print(f"[LLM] Using base model (no adapter for {adapter.name})")


class LLMService:
    """
    Main LLM service with provider fallback and LoRA routing.
    """

    def __init__(self):
        self.providers: List[LLMProvider] = [
            TogetherAIProvider(),
            OpenAIProvider(),
            AnthropicProvider(),
            GroqProvider(),
            OllamaProvider(),
            LocalHuggingFaceProvider(),
        ]

    async def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.7,
        domain: Optional[str] = None,
    ) -> str:
        """
        Generate text using the first available provider.

        Args:
            prompt: Input prompt
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            domain: Optional domain for LoRA adapter routing (local model only)

        Returns:
            Generated text response
        """
        errors = []

        for provider in self.providers:
            if not provider.is_available():
                continue

            try:
                response = await provider.generate(
                    prompt=prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    domain=domain,
                )
                if response and response.strip():
                    return response
            except Exception as e:
                errors.append(f"{provider.name}: {str(e)}")
                continue

        raise RuntimeError(f"All LLM providers failed: {'; '.join(errors)}")

    def get_available_providers(self) -> List[str]:
        """List currently available providers."""
        return [p.name for p in self.providers if p.is_available()]


llm_service = LLMService()
