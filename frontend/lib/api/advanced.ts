/**
 * API client for the advanced Python FastAPI backend.
 * Runs alongside Express backend on port 8000.
 */

const API_V2_BASE = process.env.NEXT_PUBLIC_API_V2_URL || 'http://localhost:8000/api/v2';

async function fetchV2<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const response = await fetch(`${API_V2_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || error.error || 'Request failed');
  }

  return response.json();
}

// ─── Agentic RAG API ─────────────────────────────────────────────────────────

export interface AgenticRAGRequest {
  query: string;
  workspace_id: string;
  document_id?: string;
  selected_text?: string;
  session_id?: string;
  top_k?: number;
}

export interface AgenticRAGResponse {
  response: string;
  session_id?: string;
  message_id?: string;
  source: 'document' | 'workspace' | 'none';
  source_document_name?: string;
  provider?: string;
  reasoning_trace?: {
    original_query: string;
    sub_queries: string[];
    iterations: number;
    thoughts: Array<{ step: number; thought: string; reasoning: string }>;
    actions: Array<{ step: number; action_type: string; action_input: object }>;
  };
  sub_queries?: string[];
  iterations?: number;
  glossary_terms?: Array<{ term: string; definition: string }>;
}

export const agenticRAG = {
  query: (data: AgenticRAGRequest) =>
    fetchV2<AgenticRAGResponse>('/rag/query', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  summarize: (documentId: string, workspaceId: string, summaryType: 'key_points' | 'executive' | 'detailed' = 'key_points') =>
    fetchV2<{
      summary: string;
      key_points: string[];
      document_name: string;
      word_count: number;
    }>('/rag/summarize', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        workspace_id: workspaceId,
        summary_type: summaryType,
      }),
    }),
};

// ─── Glossary API ────────────────────────────────────────────────────────────

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  category?: string;
  frequency: number;
}

export const glossaryAPI = {
  lookup: (terms: string[], workspaceId: string) =>
    fetchV2<GlossaryTerm[]>('/glossary/lookup', {
      method: 'POST',
      body: JSON.stringify({ terms, workspace_id: workspaceId }),
    }),

  search: (query: string, workspaceId: string, limit = 20) =>
    fetchV2<GlossaryTerm[]>(
      `/glossary/search?workspace_id=${workspaceId}&query=${encodeURIComponent(query)}&limit=${limit}`
    ),

  list: (workspaceId: string, page = 1, pageSize = 50) =>
    fetchV2<{
      terms: GlossaryTerm[];
      pagination: { page: number; page_size: number; total_count: number; total_pages: number };
    }>(`/glossary/list?workspace_id=${workspaceId}&page=${page}&page_size=${pageSize}`),

  add: (workspaceId: string, term: string, definition: string, category?: string) =>
    fetchV2<GlossaryTerm>('/glossary/add', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, term, definition, category }),
    }),

  delete: (termId: string, workspaceId: string) =>
    fetchV2<{ success: boolean }>(`/glossary/${termId}?workspace_id=${workspaceId}`, {
      method: 'DELETE',
    }),
};

// ─── Quiz API ────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question: string;
  question_type: 'multiple_choice' | 'true_false' | 'short_answer';
  options?: string[];
  correct_answer: string;
  explanation?: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuizResponse {
  quiz_id: string;
  document_id: string;
  document_name: string;
  questions: QuizQuestion[];
  total_questions: number;
}

export interface QuizResult {
  quiz_id: string;
  score: number;
  total: number;
  percentage: number;
  results: Array<{
    question_id: string;
    question: string;
    user_answer: string;
    correct_answer: string;
    is_correct: boolean;
    explanation?: string;
  }>;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  difficulty: string;
  question_type: string;
}

export const quizAPI = {
  generate: (
    documentId: string,
    workspaceId: string,
    questionCount = 5,
    questionTypes = ['multiple_choice', 'true_false'],
    difficulty = 'medium'
  ) =>
    fetchV2<QuizResponse>('/quiz/generate', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        workspace_id: workspaceId,
        question_count: questionCount,
        question_types: questionTypes,
        difficulty,
      }),
    }),

  getDocumentQuiz: (documentId: string, limit = 10) =>
    fetchV2<QuizResponse>(`/quiz/document/${documentId}?limit=${limit}`),

  checkAnswers: (quizId: string, answers: Record<string, string>) =>
    fetchV2<QuizResult>('/quiz/check', {
      method: 'POST',
      body: JSON.stringify({ quiz_id: quizId, answers }),
    }),

  getFlashcards: (documentId: string, limit = 20) =>
    fetchV2<{ cards: Flashcard[]; total_cards: number; document_name: string }>(
      `/quiz/flashcards/${documentId}?limit=${limit}`
    ),
};

// ─── Knowledge Graph API ─────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  type: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
}

export const graphAPI = {
  getTriplets: (workspaceId: string, documentId?: string, subject?: string, limit = 100) => {
    const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit) });
    if (documentId) params.append('document_id', documentId);
    if (subject) params.append('subject', subject);
    return fetchV2<{ nodes: GraphNode[]; edges: GraphEdge[]; total_triplets: number }>(
      `/graph/triplets?${params}`
    );
  },

  getEntityGraph: (entity: string, workspaceId: string, depth = 2) =>
    fetchV2<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
      `/graph/entity/${encodeURIComponent(entity)}?workspace_id=${workspaceId}&depth=${depth}`
    ),

  getStats: (workspaceId: string) =>
    fetchV2<{
      total_triplets: number;
      unique_entities: number;
      unique_relations: number;
      top_entities: Array<{ entity: string; count: number }>;
    }>(`/graph/stats?workspace_id=${workspaceId}`),
};
