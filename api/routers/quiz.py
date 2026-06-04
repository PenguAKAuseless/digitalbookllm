"""
Quiz Router - Quiz generation and flashcard API.
"""
import json
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from database import get_db
from database.models import Document, QuizQuestion as QuizQuestionModel
from schemas.quiz import (
    QuizGenerateRequest,
    QuizQuestion,
    QuizResponse,
    QuizAnswerRequest,
    QuizResultResponse,
    FlashcardResponse,
)
from services.llm_service import llm_service

router = APIRouter(prefix="/quiz", tags=["Quiz"])


QUIZ_GENERATION_PROMPT = """Generate {count} quiz questions from the following document content.

Document: {document_name}

Content:
{content}

Question Types to include: {question_types}
Difficulty: {difficulty}

Generate questions in this JSON format:
```json
[
    {{
        "question": "The question text?",
        "question_type": "multiple_choice",
        "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
        "correct_answer": "A",
        "explanation": "Why this is the correct answer",
        "difficulty": "{difficulty}"
    }},
    {{
        "question": "True or False: Statement here?",
        "question_type": "true_false",
        "options": ["True", "False"],
        "correct_answer": "True",
        "explanation": "Explanation of why",
        "difficulty": "{difficulty}"
    }}
]
```

Make questions educational and based on the actual document content.
"""


@router.post("/generate", response_model=QuizResponse)
async def generate_quiz(
    request: QuizGenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a quiz from a document.

    Creates questions based on document content using LLM.
    Questions are stored for later retrieval and scoring.
    """
    doc_result = await db.execute(
        select(Document).where(Document.id == request.document_id)
    )
    document = doc_result.scalar_one_or_none()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    prompt = QUIZ_GENERATION_PROMPT.format(
        count=request.question_count,
        document_name=document.name,
        content=document.full_text[:8000],
        question_types=", ".join(request.question_types),
        difficulty=request.difficulty,
    )

    try:
        response = await llm_service.generate(prompt, max_tokens=1500)

        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if json_match:
            questions_raw = json.loads(json_match.group())
        else:
            raise ValueError("Could not parse quiz questions")

        quiz_id = str(uuid.uuid4())
        questions = []

        for i, q in enumerate(questions_raw):
            q_id = str(uuid.uuid4())

            db_question = QuizQuestionModel(
                id=q_id,
                workspace_id=request.workspace_id,
                document_id=request.document_id,
                question=q["question"],
                question_type=q.get("question_type", "multiple_choice"),
                options=q.get("options"),
                correct_answer=q["correct_answer"],
                explanation=q.get("explanation"),
                difficulty=q.get("difficulty", request.difficulty),
            )
            db.add(db_question)

            questions.append(QuizQuestion(
                id=q_id,
                question=q["question"],
                question_type=q.get("question_type", "multiple_choice"),
                options=q.get("options"),
                correct_answer=q["correct_answer"],
                explanation=q.get("explanation"),
                difficulty=q.get("difficulty", request.difficulty),
            ))

        await db.commit()

        return QuizResponse(
            quiz_id=quiz_id,
            document_id=request.document_id,
            document_name=document.name,
            questions=questions,
            total_questions=len(questions),
        )

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse quiz questions")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/document/{document_id}", response_model=QuizResponse)
async def get_document_quiz(
    document_id: str,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Get existing quiz questions for a document.
    """
    doc_result = await db.execute(
        select(Document).where(Document.id == document_id)
    )
    document = doc_result.scalar_one_or_none()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    questions_result = await db.execute(
        select(QuizQuestionModel)
        .where(QuizQuestionModel.document_id == document_id)
        .limit(limit)
    )
    db_questions = questions_result.scalars().all()

    questions = [
        QuizQuestion(
            id=q.id,
            question=q.question,
            question_type=q.question_type,
            options=q.options,
            correct_answer=q.correct_answer,
            explanation=q.explanation,
            difficulty=q.difficulty,
        )
        for q in db_questions
    ]

    return QuizResponse(
        quiz_id=str(uuid.uuid4()),
        document_id=document_id,
        document_name=document.name,
        questions=questions,
        total_questions=len(questions),
    )


@router.post("/check", response_model=QuizResultResponse)
async def check_answers(
    request: QuizAnswerRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Check quiz answers and return results.
    """
    question_ids = list(request.answers.keys())

    questions_result = await db.execute(
        select(QuizQuestionModel)
        .where(QuizQuestionModel.id.in_(question_ids))
    )
    questions = {q.id: q for q in questions_result.scalars().all()}

    results = []
    correct_count = 0

    for q_id, user_answer in request.answers.items():
        question = questions.get(q_id)
        if not question:
            continue

        is_correct = user_answer.lower().strip() == question.correct_answer.lower().strip()
        if is_correct:
            correct_count += 1

        results.append({
            "question_id": q_id,
            "question": question.question,
            "user_answer": user_answer,
            "correct_answer": question.correct_answer,
            "is_correct": is_correct,
            "explanation": question.explanation,
        })

    total = len(results)
    percentage = (correct_count / total * 100) if total > 0 else 0

    return QuizResultResponse(
        quiz_id=request.quiz_id,
        score=correct_count,
        total=total,
        percentage=round(percentage, 1),
        results=results,
    )


@router.get("/flashcards/{document_id}", response_model=FlashcardResponse)
async def get_flashcards(
    document_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Get quiz questions as flashcards for study mode.

    Returns cards with front (question) and back (answer/explanation).
    """
    doc_result = await db.execute(
        select(Document).where(Document.id == document_id)
    )
    document = doc_result.scalar_one_or_none()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    questions_result = await db.execute(
        select(QuizQuestionModel)
        .where(QuizQuestionModel.document_id == document_id)
        .limit(limit)
    )
    db_questions = questions_result.scalars().all()

    cards = [
        {
            "id": q.id,
            "front": q.question,
            "back": f"{q.correct_answer}\n\n{q.explanation or ''}".strip(),
            "difficulty": q.difficulty,
            "question_type": q.question_type,
        }
        for q in db_questions
    ]

    return FlashcardResponse(
        cards=cards,
        total_cards=len(cards),
        document_name=document.name,
    )
