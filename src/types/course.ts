export type QuestionType =
  | "mcq"
  | "true_false"
  | "complete"
  | "short_answer"
  | "essay"
  | "numerical"
  | "matching";

export type DifficultyLevel = "Easy" | "Medium" | "Hard";
export type QuestionSource = "Professor" | "Lecture" | "AI Generated";
export type MaterialFileType = "pdf" | "docx" | "pptx" | "txt" | "image";

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoUrl: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Subject {
  id: string;
  ownerId: string;
  name: string;
  courseCode: string;
  professorName: string;
  description: string;
  colorAccent: string;
  analysisStatus: "idle" | "analyzing" | "completed" | "error";
  analysisSummary: string;
  materialCount: number;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  lastStudiedAt?: { seconds: number; nanoseconds: number } | null;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
}

export interface CourseMaterial {
  id: string;
  ownerId: string;
  subjectId: string;
  fileName: string;
  fileType: MaterialFileType;
  mimeType: string;
  fileSize: number;
  folder: string;
  storagePath: string;
  extractedCharCount: number;
  pageCount: number;
  chunkCount: number;
  ocrUsed: boolean;
  status: "uploaded" | "extracted" | "analyzed" | "error";
  summary: string;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
}

export interface MaterialChunk {
  id: string;
  ownerId: string;
  subjectId: string;
  materialId: string;
  chunkIndex: number;
  pageRange: string;
  text: string;
}

export interface ContentMapNode {
  id: string;
  ownerId: string;
  subjectId: string;
  lecture: string;
  topic: string;
  subtopics: string[];
  definitions: string[];
  formulas: string[];
  examples: string[];
  sourceFiles: string[];
  orderIndex: number;
}

export interface QuestionItem {
  id: string;
  ownerId: string;
  subjectId: string;
  lecture: string;
  topic: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  source: QuestionSource;
  sourceRef: string;
  prompt: string;
  options: string[];
  matchingPairs: string[];
  correctAnswer: string;
  explanation: string;
  figureUrl?: string;
  figureCaption?: string;
}

export interface QuestionAttempt {
  id: string;
  ownerId: string;
  subjectId: string;
  questionId: string;
  lecture: string;
  topic: string;
  questionType: QuestionType;
  userAnswer: string;
  isCorrect: boolean;
  attemptsCount: number;
  incorrectCount: number;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
}

export interface ExamSimulation {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  questionIds: string[];
  answers: Record<string, string>;
  durationMinutes: number;
  score: number;
  correctCount: number;
  totalQuestions: number;
  status: "in_progress" | "submitted";
  startedAt?: { seconds: number; nanoseconds: number } | null;
  submittedAt?: { seconds: number; nanoseconds: number } | null;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "Multiple Choice",
  true_false: "True / False",
  complete: "Complete the Following",
  short_answer: "Short Answer",
  essay: "Essay",
  numerical: "Numerical Problem",
  matching: "Matching",
};

export const SUBJECT_ACCENTS = [
  { id: "cobalt", label: "Academic Cobalt", hex: "#0284C7" },
  { id: "emerald", label: "Engineering Emerald", hex: "#059669" },
  { id: "indigo", label: "Theoretical Indigo", hex: "#4338CA" },
  { id: "amber", label: "Applied Amber", hex: "#D97706" },
  { id: "slate", label: "Deep Slate", hex: "#334155" },
];
