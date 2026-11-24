import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { generateWithModelFallback } from "./aiHelper.ts";

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

export interface CourseMaterialInput {
  fileName: string;
  folder: string;
  text: string;
}

export interface ContentMapNodeOutput {
  lecture: string;
  topic: string;
  subtopics: string[];
  definitions: string[];
  formulas: string[];
  examples: string[];
  sourceFiles: string[];
}

export interface GeneratedQuestionOutput {
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

const VALID_TYPES: QuestionType[] = [
  "mcq",
  "true_false",
  "complete",
  "short_answer",
  "essay",
  "numerical",
  "matching",
];

const VALID_DIFFICULTIES: DifficultyLevel[] = ["Easy", "Medium", "Hard"];
const VALID_SOURCES: QuestionSource[] = ["Professor", "Lecture", "AI Generated"];

function normalizePromptKey(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeQuestion(q: Partial<GeneratedQuestionOutput>): GeneratedQuestionOutput | null {
  const prompt = String(q.prompt || "").trim().slice(0, 3900);
  const correctAnswer = String(q.correctAnswer || "").trim().slice(0, 3900);
  const explanation = String(q.explanation || "").trim().slice(0, 5800);
  if (!prompt || !correctAnswer) return null;

  const type = VALID_TYPES.includes(q.type as QuestionType)
    ? (q.type as QuestionType)
    : "short_answer";
  const difficulty = VALID_DIFFICULTIES.includes(q.difficulty as DifficultyLevel)
    ? (q.difficulty as DifficultyLevel)
    : "Medium";
  const source = VALID_SOURCES.includes(q.source as QuestionSource)
    ? (q.source as QuestionSource)
    : "AI Generated";

  let options = Array.isArray(q.options)
    ? q.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 10)
    : [];

  if (type === "true_false") {
    options = ["True", "False"];
  } else if (type === "mcq" && options.length < 2) {
    return null;
  }

  const matchingPairs = Array.isArray(q.matchingPairs)
    ? q.matchingPairs.map((p) => String(p).trim()).filter(Boolean).slice(0, 10)
    : [];

  if (type === "matching" && matchingPairs.length < 2) {
    return null;
  }

  return {
    lecture: String(q.lecture || "General Course").trim().slice(0, 145) || "General Course",
    topic: String(q.topic || "Core Concepts").trim().slice(0, 195) || "Core Concepts",
    type,
    difficulty,
    source,
    sourceRef: String(q.sourceRef || "Course Material").trim().slice(0, 290) || "Course Material",
    prompt,
    options,
    matchingPairs,
    correctAnswer,
    explanation: explanation || `Verified from ${q.sourceRef || "course material"}.`,
    ...(q.figureUrl ? { figureUrl: String(q.figureUrl).trim().slice(0, 500) } : {}),
    ...(q.figureCaption ? { figureCaption: String(q.figureCaption).trim().slice(0, 300) } : {}),
  };
}

const QUESTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    lecture: { type: Type.STRING },
    topic: { type: Type.STRING },
    type: {
      type: Type.STRING,
      description:
        "One of: mcq, true_false, complete, short_answer, essay, numerical, matching",
    },
    difficulty: {
      type: Type.STRING,
      description: "One of: Easy, Medium, Hard",
    },
    source: {
      type: Type.STRING,
      description: "One of: Professor, Lecture, AI Generated",
    },
    sourceRef: {
      type: Type.STRING,
      description: "Exact citation e.g. 'Lecture_02.pptx, Slide 14' or 'Notes.pdf, Page 3'",
    },
    prompt: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "For mcq: exactly 4 answer options. For true_false: ['True', 'False']. Empty array for other types.",
    },
    matchingPairs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "For matching questions only: 4-5 strings formatted exactly as 'Left Term || Right Definition'. Empty array otherwise.",
    },
    correctAnswer: {
      type: Type.STRING,
      description:
        "For mcq: exact text of the single correct option. For true_false: 'True' or 'False'. For matching: concise summary of pairs. For numerical: final numeric value with units. For complete/short_answer/essay: complete model answer.",
    },
    explanation: {
      type: Type.STRING,
      description:
        "Clear, thorough step-by-step explanation written for a university student: for numericals show Given -> Formula -> Step-by-Step Calculation with units -> Final Answer; for MCQ/True-False explain why the right answer holds and why distractors/false claims fail; for Short Answer/Essay/Complete break down the core mechanism, assumptions, and reasoning.",
    },
  },
  required: [
    "lecture",
    "topic",
    "type",
    "difficulty",
    "source",
    "sourceRef",
    "prompt",
    "options",
    "matchingPairs",
    "correctAnswer",
    "explanation",
  ],
};

function buildCombinedCourseCorpus(materials: CourseMaterialInput[], maxChars = 450000): string {
  const parts: string[] = [];
  let total = 0;
  for (const mat of materials) {
    const header = `\n====================\nFILE: ${mat.fileName} (Folder/Lecture: ${mat.folder})\n====================\n`;
    const available = maxChars - total - header.length;
    if (available <= 500) break;
    const body = mat.text.slice(0, available);
    parts.push(header + body);
    total += header.length + body.length;
  }
  return parts.join("\n");
}

export async function analyzeCourseMapAndProfessorQuestions(
  ai: GoogleGenAI,
  subjectName: string,
  courseCode: string,
  materials: CourseMaterialInput[],
  alreadyExtractedVisualPrompts: string[] = []
): Promise<{
  courseSummary: string;
  contentMap: ContentMapNodeOutput[];
  extractedQuestions: GeneratedQuestionOutput[];
}> {
  const corpus = buildCombinedCourseCorpus(materials);

  const systemInstruction = `You are a meticulous university professor and teaching assistant for "${courseCode}: ${subjectName}".
Your job is to inspect EVERY uploaded course file thoroughly—never skipping small details, definitions, footnotes, equations, examples, or embedded questions.
CRITICAL ACCURACY & SOLUTION QUALITY RULES:
1. NEVER fabricate professor questions. Only tag source="Professor" if the question is explicitly written as a question/problem/exercise in the uploaded materials (preserve original wording verbatim whenever possible). Tag questions derived directly from slide exercises/in-class prompts as source="Lecture".
2. Cite exact file name and page/slide number in "sourceRef" whenever available.
3. Build a comprehensive Course Content Map covering EVERY lecture, chapter, topic, subtopic, definition, formula/equation, and worked example across all uploaded files.
4. Every "explanation" MUST be a crystal-clear, well-structured step-by-step solution (use line breaks and numbered steps):
   - Numerical problems: Given values -> Relevant formula -> Step-by-step substitution & unit conversion -> Final verified result.
   - MCQ / True-False: Explain the core rule, why the correct choice is right, and why the other choices/false statement are incorrect.
   - Short Answer / Essay / Complete / Matching: Explain the reasoning, definitions, and assumptions clearly so a student studying alone understands how to arrive at the answer.
5. NEVER create a text-only version of a question that relies on a missing diagram ("shown in figure below", "the circuit shown", etc.) if that diagram question was already extracted visually.`;

  const visualSkipNote =
    alreadyExtractedVisualPrompts.length > 0
      ? `\nALREADY EXTRACTED VISUAL/DIAGRAM QUESTIONS (DO NOT DUPLICATE AS TEXT-ONLY):\n- ${alreadyExtractedVisualPrompts
          .slice(0, 50)
          .join("\n- ")}\n`
      : "";

  const prompt = `Analyze all uploaded course materials below for ${courseCode} (${subjectName}).
Return JSON containing:
1. "courseSummary": A clear academic summary (3-5 sentences) of the full syllabus covered across the uploaded files.
2. "contentMap": An exhaustive list of structured topic nodes (aim for 12-35 nodes covering every lecture/chapter and subtopic in the files, with definitions, formulas, examples, and sourceFiles).
3. "extractedQuestions": Explicit text-based professor questions, homework problems, quiz questions, review questions, and slide exercises found anywhere in the uploaded materials (up to 45 in this pass, preserving original wording verbatim). Ensure every MCQ has 4 options and 1 unambiguous correct answer, and every question has a thorough step-by-step explanation.
${visualSkipNote}
COURSE MATERIALS:
${corpus}`;

  const response = await generateWithModelFallback(ai, {
    contents: prompt,
    systemInstruction,
    thinkingLevel: ThinkingLevel.HIGH,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        courseSummary: { type: Type.STRING },
        contentMap: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              lecture: { type: Type.STRING },
              topic: { type: Type.STRING },
              subtopics: { type: Type.ARRAY, items: { type: Type.STRING } },
              definitions: { type: Type.ARRAY, items: { type: Type.STRING } },
              formulas: { type: Type.ARRAY, items: { type: Type.STRING } },
              examples: { type: Type.ARRAY, items: { type: Type.STRING } },
              sourceFiles: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "lecture",
              "topic",
              "subtopics",
              "definitions",
              "formulas",
              "examples",
              "sourceFiles",
            ],
          },
        },
        extractedQuestions: {
          type: Type.ARRAY,
          items: QUESTION_SCHEMA,
        },
      },
      required: ["courseSummary", "contentMap", "extractedQuestions"],
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim()) as {
    courseSummary?: string;
    contentMap?: Partial<ContentMapNodeOutput>[];
    extractedQuestions?: Partial<GeneratedQuestionOutput>[];
  };

  const contentMap: ContentMapNodeOutput[] = (parsed.contentMap || [])
    .filter((n) => n.lecture && n.topic)
    .map((n) => ({
      lecture: String(n.lecture).trim().slice(0, 145),
      topic: String(n.topic).trim().slice(0, 195),
      subtopics: (n.subtopics || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 35),
      definitions: (n.definitions || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 35),
      formulas: (n.formulas || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 35),
      examples: (n.examples || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 35),
      sourceFiles: (n.sourceFiles || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 25),
    }));

  const extractedQuestions = (parsed.extractedQuestions || [])
    .map(sanitizeQuestion)
    .filter((q): q is GeneratedQuestionOutput => q !== null);

  return {
    courseSummary:
      String(parsed.courseSummary || "Course materials analyzed and mapped.").trim().slice(0, 2400),
    contentMap,
    extractedQuestions,
  };
}

export async function generateQuestionBatchForTopics(
  ai: GoogleGenAI,
  params: {
    subjectName: string;
    courseCode: string;
    materials: CourseMaterialInput[];
    focusNodes: ContentMapNodeOutput[];
    batchSize: number;
    batchIndex: number;
    totalBatches: number;
    existingPromptSamples: string[];
    preferredSource: "Lecture" | "AI Generated";
  }
): Promise<GeneratedQuestionOutput[]> {
  const {
    subjectName,
    courseCode,
    materials,
    focusNodes,
    batchSize,
    batchIndex,
    totalBatches,
    existingPromptSamples,
    preferredSource,
  } = params;

  const relevantFiles = new Set(
    focusNodes.flatMap((n) => n.sourceFiles.map((f) => f.toLowerCase()))
  );
  const prioritizedMaterials = [
    ...materials.filter((m) => relevantFiles.has(m.fileName.toLowerCase())),
    ...materials.filter((m) => !relevantFiles.has(m.fileName.toLowerCase())),
  ];
  const corpus = buildCombinedCourseCorpus(prioritizedMaterials, 220000);

  const focusSummary = focusNodes
    .map(
      (n, idx) =>
        `${idx + 1}. [${n.lecture}] ${n.topic}\n   Subtopics: ${n.subtopics.join("; ")}\n   Definitions: ${n.definitions.slice(0, 8).join("; ")}\n   Formulas: ${n.formulas.slice(0, 8).join("; ")}\n   Examples: ${n.examples.slice(0, 6).join("; ")}\n   Sources: ${n.sourceFiles.join(", ")}`
    )
    .join("\n\n");

  const avoidList = existingPromptSamples.slice(-80).join("\n- ");

  const prompt = `Generate EXACTLY ${batchSize} UNIQUE, high-rigor university exam questions (Batch ${batchIndex + 1} of ${totalBatches}) for "${courseCode}: ${subjectName}" strictly grounded in the course materials and focus topics below.

STRICT DISTRIBUTION IN THIS BATCH OF ${batchSize} QUESTIONS:
- Include all 7 question types proportionally:
  * ~30% "mcq" (4 distinct options, exactly 1 unambiguously correct answer)
  * ~15% "true_false" (options: ["True", "False"]; if False, explain the exact correction)
  * ~15% "complete" (fill-in-the-blank definition, missing term, equation, or technical terminology)
  * ~15% "short_answer" (explain concept, define term, state assumptions, compare, or list characteristics)
  * ~10% "essay" (comprehensive theoretical, mechanism, or engineering application)
  * ~10% "numerical" (real calculations, equation solving, unit conversions; mathematically verify every arithmetic step in explanation and give exact final answer with units)
  * ~5% "matching" (4 pairs formatted as "Term || Definition" in matchingPairs)
- Mix Difficulty: ~35% Easy, ~40% Medium, ~25% Hard.
- Tag source as "${preferredSource}" (use "Lecture" when directly derived from lecture slides/examples/exercises, or "AI Generated" when synthesizing deeper conceptual/gap coverage from the course content). NEVER tag "Professor" unless quoting a verbatim professor problem not yet captured.
- Cite exact file name and page/slide number in "sourceRef".
- EXPLANATION QUALITY (CRITICAL): Every question's "explanation" MUST clearly teach the student how to solve it using structured numbered steps or clear sentences (never vague 1-line stubs):
  * Numerical: Step 1 (Given), Step 2 (Equation), Step 3 (Substitution & Units), Step 4 (Final Answer).
  * MCQ / True-False: State why the correct option/truth value is right AND explain why the incorrect options/claim are wrong.
  * Short Answer / Essay / Complete / Matching: Walk through the concept, definitions, and reasoning clearly.
- ZERO DUPLICATES OR TRIVIAL REWORDINGS. Do not repeat or rephrase any of these existing prompts:
- ${avoidList || "None yet"}

FOCUS TOPICS FOR THIS BATCH:
${focusSummary}

SOURCE MATERIALS:
${corpus}`;

  const response = await generateWithModelFallback(ai, {
    contents: prompt,
    systemInstruction: `You are a university professor and exam writer creating rigorous, non-repetitive exam questions strictly grounded in the provided course materials. Every numerical problem must be mathematically verified step by step. Output strictly valid JSON matching the schema.`,
    thinkingLevel: ThinkingLevel.MEDIUM,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: QUESTION_SCHEMA,
        },
      },
      required: ["questions"],
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim()) as {
    questions?: Partial<GeneratedQuestionOutput>[];
  };

  return (parsed.questions || [])
    .map(sanitizeQuestion)
    .filter((q): q is GeneratedQuestionOutput => q !== null);
}

export function deduplicateQuestions(
  existingKeys: Set<string>,
  candidates: GeneratedQuestionOutput[]
): GeneratedQuestionOutput[] {
  const accepted: GeneratedQuestionOutput[] = [];
  for (const q of candidates) {
    const key = normalizePromptKey(q.prompt);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    accepted.push(q);
  }
  return accepted;
}

export async function evaluateFreeformAnswer(
  ai: GoogleGenAI,
  params: {
    questionPrompt: string;
    questionType: QuestionType;
    correctAnswer: string;
    explanation: string;
    userAnswer: string;
  }
): Promise<{ isCorrect: boolean; feedback: string; scorePercent: number }> {
  const { questionPrompt, questionType, correctAnswer, explanation, userAnswer } = params;
  const trimmedUser = userAnswer.trim();
  const trimmedCorrect = correctAnswer.trim();

  if (!trimmedUser) {
    return {
      isCorrect: false,
      feedback: "No answer submitted.",
      scorePercent: 0,
    };
  }

  if (questionType === "mcq" || questionType === "true_false") {
    const isCorrect =
      trimmedUser.toLowerCase() === trimmedCorrect.toLowerCase();
    return {
      isCorrect,
      feedback: isCorrect
        ? "Correct answer."
        : `Incorrect. The correct answer is "${trimmedCorrect}".`,
      scorePercent: isCorrect ? 100 : 0,
    };
  }

  if (
    trimmedUser.toLowerCase().replace(/\s+/g, " ") ===
    trimmedCorrect.toLowerCase().replace(/\s+/g, " ")
  ) {
    return {
      isCorrect: true,
      feedback: "Exact match with the reference answer.",
      scorePercent: 100,
    };
  }

  if (questionType === "numerical") {
    const numU = parseFloat(trimmedUser.replace(/,/g, ""));
    const numC = parseFloat(trimmedCorrect.replace(/,/g, ""));
    if (Number.isFinite(numU) && Number.isFinite(numC)) {
      const tol = Math.max(1e-4, Math.abs(numC) * 0.02);
      if (Math.abs(numU - numC) <= tol) {
        return {
          isCorrect: true,
          feedback: `Numerical result matches (${trimmedCorrect}).`,
          scorePercent: 100,
        };
      }
    }
  }

  const response = await generateWithModelFallback(ai, {
    contents: `Grade this university student's answer objectively against the reference answer and solution explanation.
Question Type: ${questionType}
Question: ${questionPrompt}
Reference Correct Answer: ${correctAnswer}
Solution Explanation: ${explanation}
Student's Answer: ${userAnswer}

For numerical answers, allow equivalent numeric formatting or rounded forms within 2% tolerance if units are consistent. For short answer, complete, matching, or essay answers, mark isCorrect=true if the student demonstrates accurate understanding of the core required concepts (scorePercent >= 70).`,
    thinkingLevel: ThinkingLevel.LOW,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        isCorrect: { type: Type.BOOLEAN },
        scorePercent: { type: Type.INTEGER },
        feedback: { type: Type.STRING },
      },
      required: ["isCorrect", "scorePercent", "feedback"],
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim()) as {
    isCorrect?: boolean;
    scorePercent?: number;
    feedback?: string;
  };

  return {
    isCorrect: Boolean(parsed.isCorrect),
    scorePercent: Math.max(0, Math.min(100, Math.round(parsed.scorePercent ?? (parsed.isCorrect ? 100 : 0)))),
    feedback: (parsed.feedback || explanation).trim(),
  };
}
