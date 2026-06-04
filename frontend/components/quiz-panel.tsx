"use client"

import { useState } from "react"
import {
    Brain, ChevronLeft, ChevronRight, Check, X, RotateCcw,
    Loader2, Sparkles, BookOpen, Award, Lightbulb
} from "lucide-react"
import { quizAPI, QuizResponse, QuizResult, Flashcard } from "@/lib/api/advanced"

interface QuizPanelProps {
    documentId: string
    workspaceId: string
    documentName: string
    onClose: () => void
}

type ViewMode = "menu" | "quiz" | "flashcard" | "results"

export function QuizPanel({ documentId, workspaceId, documentName, onClose }: QuizPanelProps) {
    const [viewMode, setViewMode] = useState<ViewMode>("menu")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Quiz state
    const [quiz, setQuiz] = useState<QuizResponse | null>(null)
    const [currentIndex, setCurrentIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [results, setResults] = useState<QuizResult | null>(null)

    // Flashcard state
    const [flashcards, setFlashcards] = useState<Flashcard[]>([])
    const [cardIndex, setCardIndex] = useState(0)
    const [isFlipped, setIsFlipped] = useState(false)

    // Quiz settings
    const [questionCount, setQuestionCount] = useState(5)
    const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium")

    const generateQuiz = async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await quizAPI.generate(
                documentId,
                workspaceId,
                questionCount,
                ["multiple_choice", "true_false"],
                difficulty
            )
            setQuiz(response)
            setCurrentIndex(0)
            setAnswers({})
            setResults(null)
            setViewMode("quiz")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to generate quiz")
        } finally {
            setLoading(false)
        }
    }

    const loadFlashcards = async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await quizAPI.getFlashcards(documentId, 20)
            if (response.cards.length === 0) {
                await generateQuiz()
                const flashcardResponse = await quizAPI.getFlashcards(documentId, 20)
                setFlashcards(flashcardResponse.cards)
            } else {
                setFlashcards(response.cards)
            }
            setCardIndex(0)
            setIsFlipped(false)
            setViewMode("flashcard")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load flashcards")
        } finally {
            setLoading(false)
        }
    }

    const handleAnswer = (questionId: string, answer: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: answer }))
    }

    const submitQuiz = async () => {
        if (!quiz) return
        setLoading(true)
        try {
            const result = await quizAPI.checkAnswers(quiz.quiz_id, answers)
            setResults(result)
            setViewMode("results")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to submit quiz")
        } finally {
            setLoading(false)
        }
    }

    const currentQuestion = quiz?.questions[currentIndex]
    const currentCard = flashcards[cardIndex]
    const answeredCount = Object.keys(answers).length
    const totalQuestions = quiz?.total_questions || 0

    return (
        <div className="flex flex-col h-full bg-card">
            {/* Header */}
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" />
                    <span className="font-semibold text-sm">
                        {viewMode === "menu" && "Study Mode"}
                        {viewMode === "quiz" && "Quiz"}
                        {viewMode === "flashcard" && "Flashcards"}
                        {viewMode === "results" && "Results"}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-muted transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
                {error && (
                    <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
                        {error}
                    </div>
                )}

                {/* Menu View */}
                {viewMode === "menu" && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground text-center mb-6">
                            Study &ldquo;{documentName}&rdquo;
                        </p>

                        {/* Quiz Option */}
                        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-primary" />
                                <span className="font-medium">Generate Quiz</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                AI-generated questions to test your knowledge
                            </p>

                            <div className="flex gap-2">
                                <select
                                    value={questionCount}
                                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                                    className="flex-1 px-2 py-1 text-xs rounded bg-background border border-border"
                                >
                                    <option value={5}>5 questions</option>
                                    <option value={10}>10 questions</option>
                                    <option value={15}>15 questions</option>
                                </select>
                                <select
                                    value={difficulty}
                                    onChange={(e) => setDifficulty(e.target.value as "easy" | "medium" | "hard")}
                                    className="flex-1 px-2 py-1 text-xs rounded bg-background border border-border"
                                >
                                    <option value="easy">Easy</option>
                                    <option value="medium">Medium</option>
                                    <option value="hard">Hard</option>
                                </select>
                            </div>

                            <button
                                onClick={generateQuiz}
                                disabled={loading}
                                className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                Start Quiz
                            </button>
                        </div>

                        {/* Flashcard Option */}
                        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-primary" />
                                <span className="font-medium">Flashcards</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Study with flip cards for active recall
                            </p>
                            <button
                                onClick={loadFlashcards}
                                disabled={loading}
                                className="w-full py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                                Start Flashcards
                            </button>
                        </div>
                    </div>
                )}

                {/* Quiz View */}
                {viewMode === "quiz" && currentQuestion && (
                    <div className="space-y-4">
                        {/* Progress */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Question {currentIndex + 1} of {totalQuestions}</span>
                            <span>{answeredCount} answered</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                            <div
                                className="bg-primary h-1.5 rounded-full transition-all"
                                style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }}
                            />
                        </div>

                        {/* Question */}
                        <div className="bg-muted/50 rounded-lg p-4">
                            <p className="font-medium mb-4">{currentQuestion.question}</p>

                            {/* Options */}
                            <div className="space-y-2">
                                {currentQuestion.options?.map((option, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleAnswer(currentQuestion.id, option.charAt(0))}
                                        className={`w-full text-left p-3 rounded-lg border transition-colors ${answers[currentQuestion.id] === option.charAt(0)
                                                ? "border-primary bg-primary/10"
                                                : "border-border hover:border-primary/50"
                                            }`}
                                    >
                                        <span className="text-sm">{option}</span>
                                    </button>
                                ))}

                                {currentQuestion.question_type === "true_false" && !currentQuestion.options && (
                                    <>
                                        <button
                                            onClick={() => handleAnswer(currentQuestion.id, "True")}
                                            className={`w-full text-left p-3 rounded-lg border transition-colors ${answers[currentQuestion.id] === "True"
                                                    ? "border-primary bg-primary/10"
                                                    : "border-border hover:border-primary/50"
                                                }`}
                                        >
                                            <span className="text-sm">True</span>
                                        </button>
                                        <button
                                            onClick={() => handleAnswer(currentQuestion.id, "False")}
                                            className={`w-full text-left p-3 rounded-lg border transition-colors ${answers[currentQuestion.id] === "False"
                                                    ? "border-primary bg-primary/10"
                                                    : "border-border hover:border-primary/50"
                                                }`}
                                        >
                                            <span className="text-sm">False</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Navigation */}
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                                disabled={currentIndex === 0}
                                className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg hover:bg-muted disabled:opacity-50"
                            >
                                <ChevronLeft className="w-4 h-4" /> Prev
                            </button>

                            {currentIndex === totalQuestions - 1 ? (
                                <button
                                    onClick={submitQuiz}
                                    disabled={loading || answeredCount < totalQuestions}
                                    className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                    Submit
                                </button>
                            ) : (
                                <button
                                    onClick={() => setCurrentIndex(Math.min(totalQuestions - 1, currentIndex + 1))}
                                    className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg hover:bg-muted"
                                >
                                    Next <ChevronRight className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* Quick navigation dots */}
                        <div className="flex justify-center gap-1 flex-wrap">
                            {quiz?.questions.map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentIndex(idx)}
                                    className={`w-6 h-6 text-xs rounded-full transition-colors ${idx === currentIndex
                                            ? "bg-primary text-primary-foreground"
                                            : answers[quiz.questions[idx].id]
                                                ? "bg-primary/30 text-foreground"
                                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                                        }`}
                                >
                                    {idx + 1}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Flashcard View */}
                {viewMode === "flashcard" && currentCard && (
                    <div className="space-y-4">
                        {/* Progress */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Card {cardIndex + 1} of {flashcards.length}</span>
                            <span className="text-primary">{currentCard.difficulty}</span>
                        </div>

                        {/* Card */}
                        <div
                            onClick={() => setIsFlipped(!isFlipped)}
                            className="min-h-[200px] bg-muted/50 rounded-lg p-6 cursor-pointer hover:bg-muted/70 transition-colors flex items-center justify-center"
                        >
                            <div className="text-center">
                                {!isFlipped ? (
                                    <>
                                        <p className="font-medium text-lg mb-2">{currentCard.front}</p>
                                        <p className="text-xs text-muted-foreground">Tap to reveal answer</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm whitespace-pre-wrap">{currentCard.back}</p>
                                        <p className="text-xs text-muted-foreground mt-4">Tap to see question</p>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Navigation */}
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => { setCardIndex(Math.max(0, cardIndex - 1)); setIsFlipped(false); }}
                                disabled={cardIndex === 0}
                                className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg hover:bg-muted disabled:opacity-50"
                            >
                                <ChevronLeft className="w-4 h-4" /> Prev
                            </button>

                            <button
                                onClick={() => setIsFlipped(!isFlipped)}
                                className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90"
                            >
                                <RotateCcw className="w-4 h-4 inline mr-1" /> Flip
                            </button>

                            <button
                                onClick={() => { setCardIndex(Math.min(flashcards.length - 1, cardIndex + 1)); setIsFlipped(false); }}
                                disabled={cardIndex === flashcards.length - 1}
                                className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg hover:bg-muted disabled:opacity-50"
                            >
                                Next <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Quick navigation */}
                        <div className="flex justify-center gap-1 flex-wrap">
                            {flashcards.map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => { setCardIndex(idx); setIsFlipped(false); }}
                                    className={`w-6 h-6 text-xs rounded-full transition-colors ${idx === cardIndex
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                        }`}
                                >
                                    {idx + 1}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results View */}
                {viewMode === "results" && results && (
                    <div className="space-y-4">
                        {/* Score */}
                        <div className="text-center py-6">
                            <Award className={`w-12 h-12 mx-auto mb-2 ${results.percentage >= 70 ? "text-green-500" : results.percentage >= 50 ? "text-yellow-500" : "text-red-500"}`} />
                            <p className="text-3xl font-bold">{results.percentage}%</p>
                            <p className="text-sm text-muted-foreground">
                                {results.score} out of {results.total} correct
                            </p>
                        </div>

                        {/* Results breakdown */}
                        <div className="space-y-2">
                            {results.results.map((r, idx) => (
                                <div
                                    key={idx}
                                    className={`p-3 rounded-lg border ${r.is_correct ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"}`}
                                >
                                    <div className="flex items-start gap-2">
                                        {r.is_correct ? (
                                            <Check className="w-4 h-4 text-green-500 mt-0.5" />
                                        ) : (
                                            <X className="w-4 h-4 text-red-500 mt-0.5" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium line-clamp-2">{r.question}</p>
                                            {!r.is_correct && (
                                                <p className="text-xs mt-1">
                                                    <span className="text-red-500">Your answer: {r.user_answer}</span>
                                                    <span className="text-muted-foreground"> • </span>
                                                    <span className="text-green-500">Correct: {r.correct_answer}</span>
                                                </p>
                                            )}
                                            {r.explanation && (
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    <Lightbulb className="w-3 h-3 inline mr-1" />
                                                    {r.explanation}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => setViewMode("menu")}
                                className="flex-1 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/90"
                            >
                                Back to Menu
                            </button>
                            <button
                                onClick={generateQuiz}
                                className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                )}

                {/* Loading state */}
                {loading && viewMode !== "menu" && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                )}
            </div>
        </div>
    )
}
