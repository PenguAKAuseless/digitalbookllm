"""
SQLAlchemy ORM models for DigitalBookLLM.
Compatible with existing PostgreSQL schema from Express backend.
"""
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    String, Text, Integer, BigInteger, Float, DateTime, Date,
    ForeignKey, Index, CheckConstraint, UniqueConstraint, JSON, ARRAY
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    workspaces: Mapped[List["Workspace"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    documents: Mapped[List["Document"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    chat_sessions: Mapped[List["ChatSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    user_session: Mapped[Optional["UserSession"]] = relationship(back_populates="user", uselist=False)


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="workspaces_user_id_name_key"),
        Index("workspaces_user_id_idx", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    domain: Mapped[Optional[str]] = mapped_column(String(100))  # For LoRA adapter routing: 'medical', 'it', 'legal', etc.
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="workspaces")
    documents: Mapped[List["Document"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    chat_sessions: Mapped[List["ChatSession"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    glossary_terms: Mapped[List["GlossaryTerm"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    knowledge_triplets: Mapped[List["KnowledgeTriplet"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("documents_workspace_id_idx", "workspace_id"),
        Index("documents_user_id_idx", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(255), ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    full_text: Mapped[str] = mapped_column(Text, nullable=False)
    file_path: Mapped[Optional[str]] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workspace: Mapped["Workspace"] = relationship(back_populates="documents")
    user: Mapped["User"] = relationship(back_populates="documents")
    chunks: Mapped[List["Chunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    chat_sessions: Mapped[List["ChatSession"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    quiz_questions: Mapped[List["QuizQuestion"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="chunks_document_id_chunk_index_key"),
        Index("chunks_document_id_idx", "document_id"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(255), ForeignKey("documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(384))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    document: Mapped["Document"] = relationship(back_populates="chunks")


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index("chat_sessions_workspace_id_idx", "workspace_id"),
        Index("chat_sessions_document_id_idx", "document_id"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(255), ForeignKey("workspaces.id", ondelete="CASCADE"))
    document_id: Mapped[Optional[str]] = mapped_column(String(255), ForeignKey("documents.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(String(255), ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="New Chat")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workspace: Mapped["Workspace"] = relationship(back_populates="chat_sessions")
    document: Mapped[Optional["Document"]] = relationship(back_populates="chat_sessions")
    user: Mapped["User"] = relationship(back_populates="chat_sessions")
    messages: Mapped[List["ChatMessage"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("chat_messages_session_id_idx", "session_id"),
        CheckConstraint("role IN ('user', 'assistant')", name="chat_messages_role_check"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    session_id: Mapped[str] = mapped_column(String(255), ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    selected_text: Mapped[Optional[str]] = mapped_column(Text)
    retrieved_chunks: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text))
    source: Mapped[Optional[str]] = mapped_column(String(20))
    source_document_name: Mapped[Optional[str]] = mapped_column(String(500))
    provider: Mapped[Optional[str]] = mapped_column(String(50))
    reasoning_trace: Mapped[Optional[dict]] = mapped_column(JSON)  # Store ReAct reasoning steps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped["ChatSession"] = relationship(back_populates="messages")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(255), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    queries_today: Mapped[int] = mapped_column(Integer, default=0)
    last_reset_date: Mapped[datetime] = mapped_column(Date, default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="user_session")


class GlossaryTerm(Base):
    """Dynamic glossary terms extracted from documents via NER."""
    __tablename__ = "glossary_terms"
    __table_args__ = (
        UniqueConstraint("workspace_id", "term", name="glossary_terms_workspace_term_key"),
        Index("glossary_terms_workspace_id_idx", "workspace_id"),
        Index("glossary_terms_term_idx", "term"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(255), ForeignKey("workspaces.id", ondelete="CASCADE"))
    term: Mapped[str] = mapped_column(String(500), nullable=False)
    definition: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100))  # e.g., 'medical', 'technical', 'acronym'
    source_document_id: Mapped[Optional[str]] = mapped_column(String(255))
    frequency: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workspace: Mapped["Workspace"] = relationship(back_populates="glossary_terms")


class KnowledgeTriplet(Base):
    """Knowledge graph triplets (Subject, Relation, Object) for Graph RAG."""
    __tablename__ = "knowledge_triplets"
    __table_args__ = (
        Index("knowledge_triplets_workspace_id_idx", "workspace_id"),
        Index("knowledge_triplets_subject_idx", "subject"),
        Index("knowledge_triplets_object_idx", "object"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(255), ForeignKey("workspaces.id", ondelete="CASCADE"))
    document_id: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    relation: Mapped[str] = mapped_column(String(255), nullable=False)
    object: Mapped[str] = mapped_column(String(500), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    source_chunk_id: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    workspace: Mapped["Workspace"] = relationship(back_populates="knowledge_triplets")


class QuizQuestion(Base):
    """Quiz questions generated from documents."""
    __tablename__ = "quiz_questions"
    __table_args__ = (
        Index("quiz_questions_document_id_idx", "document_id"),
        Index("quiz_questions_workspace_id_idx", "workspace_id"),
    )

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(255))
    document_id: Mapped[str] = mapped_column(String(255), ForeignKey("documents.id", ondelete="CASCADE"))
    question: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 'multiple_choice', 'true_false', 'short_answer'
    options: Mapped[Optional[List[str]]] = mapped_column(JSON)  # For multiple choice
    correct_answer: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[Optional[str]] = mapped_column(Text)
    difficulty: Mapped[str] = mapped_column(String(20), default="medium")  # 'easy', 'medium', 'hard'
    source_chunk_id: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    document: Mapped["Document"] = relationship(back_populates="quiz_questions")
