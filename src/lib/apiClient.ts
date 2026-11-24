import { auth } from "./firebase";
import { MaterialFileType, QuestionType } from "../types/course";

const MAX_SINGLE_FILE_BYTES = 29 * 1024 * 1024;

async function getBearerHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("You must be signed in to perform this action.");
  }
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function parseJsonResponse<T>(resp: Response, fallbackMessage: string): Promise<T> {
  const raw = await resp.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (resp.status === 413) {
      throw new Error("File is too large for upload (max 29 MB per file).");
    }
    if (resp.status === 502 || resp.status === 504) {
      throw new Error(
        "The server timed out while extracting this file. Please try a smaller or split file."
      );
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Authentication expired. Please sign out and sign in again.");
    }
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
      throw new Error(
        `${fallbackMessage} (Server returned HTTP ${resp.status} HTML instead of JSON. Please refresh and try again.)`
      );
    }
    throw new Error(raw.slice(0, 200) || fallbackMessage);
  }
}

export interface ExtractedMaterialPayload {
  fileName: string;
  fileType: MaterialFileType;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  extractedCharCount: number;
  pageCount: number;
  ocrUsed: boolean;
  summary: string;
  chunks: { chunkIndex: number; pageRange: string; text: string }[];
}

export async function uploadAndExtractFiles(
  subjectId: string,
  files: File[],
  onProgress?: (index: number, total: number, fileName: string) => void
): Promise<ExtractedMaterialPayload[]> {
  const results: ExtractedMaterialPayload[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      throw new Error(
        `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum supported size is 29 MB per file.`
      );
    }

    if (onProgress) {
      onProgress(i + 1, files.length, file.name);
    }

    const headers = await getBearerHeader();
    const formData = new FormData();
    formData.append("subjectId", subjectId);
    formData.append("files", file);

    const resp = await fetch("/api/materials/extract", {
      method: "POST",
      headers,
      body: formData,
    });

    const data = await parseJsonResponse<{
      materials?: ExtractedMaterialPayload[];
      error?: string;
    }>(resp, `Failed to extract "${file.name}"`);

    if (!resp.ok || !data.materials) {
      throw new Error(data.error || `Failed to extract "${file.name}".`);
    }

    results.push(...data.materials);
  }

  return results;
}

export interface AnalyzeStreamCallbacks {
  onStage: (payload: { stage: string; message: string; progressPct: number }) => void;
  onContentMap: (payload: {
    courseSummary: string;
    nodes: {
      lecture: string;
      topic: string;
      subtopics: string[];
      definitions: string[];
      formulas: string[];
      examples: string[];
      sourceFiles: string[];
    }[];
  }) => Promise<void> | void;
  onQuestions: (payload: {
    questions: {
      lecture: string;
      topic: string;
      type: QuestionType;
      difficulty: "Easy" | "Medium" | "Hard";
      source: "Professor" | "Lecture" | "AI Generated";
      sourceRef: string;
      prompt: string;
      options: string[];
      matchingPairs: string[];
      correctAnswer: string;
      explanation: string;
      figureUrl?: string;
      figureCaption?: string;
    }[];
    totalGenerated: number;
    targetCount: number;
  }) => Promise<void> | void;
  onComplete: (payload: {
    totalQuestions: number;
    professorCount: number;
    lectureCount: number;
    aiGeneratedCount: number;
    courseSummary: string;
  }) => Promise<void> | void;
  onError: (message: string) => void;
}

export async function streamCourseAnalysis(
  params: {
    subjectId?: string;
    subjectName: string;
    courseCode: string;
    targetCount: number;
    materials: {
      fileName: string;
      folder: string;
      text: string;
      fileType?: string;
      storagePath?: string;
    }[];
    existingPrompts?: string[];
  },
  callbacks: AnalyzeStreamCallbacks
): Promise<void> {
  const headers = await getBearerHeader();
  const resp = await fetch("/api/courses/analyze-stream", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => "Analysis stream failed.");
    throw new Error(
      errText.trim().toLowerCase().startsWith("<!doctype")
        ? `Analysis request failed (HTTP ${resp.status}).`
        : errText || "Failed to start course analysis."
    );
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBlock = async (block: string) => {
    const lines = block.split("\n");
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) return;
    const rawJson = dataLines.join("\n");
    const parsed = JSON.parse(rawJson);

    if (eventName === "stage") {
      callbacks.onStage(parsed);
    } else if (eventName === "contentMap") {
      await callbacks.onContentMap(parsed);
    } else if (eventName === "questions") {
      await callbacks.onQuestions(parsed);
    } else if (eventName === "complete") {
      await callbacks.onComplete(parsed);
    } else if (eventName === "error") {
      callbacks.onError(parsed.message || "Analysis error occurred.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      if (part.trim()) {
        await processBlock(part);
      }
    }
  }

  if (buffer.trim()) {
    await processBlock(buffer);
  }
}

export async function evaluateAnswerWithAi(params: {
  questionPrompt: string;
  questionType: QuestionType;
  correctAnswer: string;
  explanation: string;
  userAnswer: string;
}): Promise<{ isCorrect: boolean; feedback: string; scorePercent: number }> {
  const headers = await getBearerHeader();
  const resp = await fetch("/api/questions/evaluate", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const data = await parseJsonResponse<{
    isCorrect?: boolean;
    feedback?: string;
    scorePercent?: number;
    error?: string;
  }>(resp, "Failed to evaluate answer");

  if (!resp.ok) {
    throw new Error(data.error || "Failed to evaluate answer.");
  }

  return {
    isCorrect: Boolean(data.isCorrect),
    feedback: data.feedback || "",
    scorePercent: data.scorePercent ?? 0,
  };
}
