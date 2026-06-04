"""
Configuration settings for the DigitalBookLLM Python API.
"""
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "DigitalBookLLM API"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v2"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database - PostgreSQL
    DB_HOST: str = "localhost"
    DB_PORT: int = 5433
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "password"
    DB_NAME: str = "digitalbookllm"

    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def SYNC_DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    # Qdrant Vector DB
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    QDRANT_COLLECTION: str = "digitalbookllm_chunks"

    # JWT Auth (compatible with existing Express backend)
    JWT_SECRET: str = "your-super-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_DAYS: int = 7

    # LLM Providers
    TOGETHER_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    OLLAMA_URL: Optional[str] = None

    # Model Configuration
    BASE_LLM_MODEL: str = "Qwen/Qwen2.5-7B-Instruct"
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DIMENSION: int = 384

    # LoRA Configuration
    LORA_ADAPTERS_PATH: str = "./lora_adapters"
    DEFAULT_LORA_ADAPTER: str = "general"

    # Agentic RAG Configuration
    MAX_RAG_ITERATIONS: int = 5
    MAX_SUB_QUERIES: int = 3
    RETRIEVAL_TOP_K: int = 5
    SIMILARITY_THRESHOLD: float = 0.2

    # Rate Limiting
    MAX_QUERIES_PER_DAY: int = 100

    # File Upload
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE_MB: int = 50

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
