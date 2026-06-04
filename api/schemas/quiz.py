"""Pydantic schemas for Quiz endpoints."""
from typing import Optional, List
from pydantic import BaseModel, Field


class QuizGenerateRequest(BaseModel):
    """Request schema for quiz generation."""
    document_id: str = Field(..., description="Document to generate quiz from")
    workspace_id: str = Field(..., description="Workspace ID")
    question_count: int = Field(5, ge=1, le=20, description="Number of questions")
    question_types: List[str] = Field(
        ["multiple_choice", "true_false"],
        description="Types of questions to generate"
    )
    difficulty: str = Field("medium", description="Difficulty level: easy, medium, hard")


class QuizQuestion(BaseModel):
    """Schema for a single quiz question."""
    id: str
    question: str
    question_type: str  # multiple_choice, true_false, short_answer
    options: Optional[List[str]] = None  # For multiple choice
    correct_answer: str
    explanation: Optional[str] = None
    difficulty: str


class QuizResponse(BaseModel):
    """Response schema for generated quiz."""
    quiz_id: str
    document_id: str
    document_name: str
    questions: List[QuizQuestion]
    total_questions: int


class QuizAnswerRequest(BaseModel):
    """Request schema for submitting quiz answers."""
    quiz_id: str
    answers: dict  # question_id -> user_answer


class QuizResultResponse(BaseModel):
    """Response schema for quiz results."""
    quiz_id: str
    score: int
    total: int
    percentage: float
    results: List[dict]  # Per-question results with correct/incorrect


class FlashcardResponse(BaseModel):
    """Response schema for flashcard mode."""
    cards: List[dict]  # [{front: question, back: answer, id: ...}]
    total_cards: int
    document_name: str
