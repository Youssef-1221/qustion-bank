import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { extractMaterialContent, splitIntoChunks } from "./server/extractors.ts";
import {
  analyzeCourseMapAndProfessorQuestions,
  CourseMaterialInput,
  deduplicateQuestions,
  evaluateFreeformAnswer,
  GeneratedQuestionOutput,
  generateQuestionBatchForTopics,
  QuestionType,
} from "./server/geminiCourseAi.ts";
import {
  cleanOldSubjectCrops,
  extractVisualQuestionsFromCourseFiles,
} from "./server/visualExtractor.ts";
import { formatFriendlyAiError, isDailyQuotaError } from "./server/aiHelper.ts";

interface FirebaseConfig {
  projectId: string;
  apiKey: string;
}

const firebaseConfigPath = path.resolve(process.cwd(), "firebase-applet-config.json");
const firebaseConfig: FirebaseConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, "utf-8")
);

const PORT = 3000;
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please check the Settings > Secrets panel."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

const tokenCache = new Map<string, { uid: string; email: string; expiresAt: number }>();

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email: string }> {
  const hash = crypto.createHash("sha256").update(idToken).digest("hex");
  const cached = tokenCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return { uid: cached.uid, email: cached.email };
  }

  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!resp.ok) {
    throw new Error("Invalid or expired authentication token.");
  }

  const data = (await resp.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
    }>;
  };

  const user = data.users?.[0];
  if (!user?.localId || !user.emailVerified) {
    throw new Error("Authenticated verified user required.");
  }

  tokenCache.set(hash, {
    uid: user.localId,
    email: user.email || "",
    expiresAt: Date.now() + 60_000,
  });

  if (tokenCache.size > 500) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }

  return { uid: user.localId, email: user.email || "" };
}

async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      res.status(401).json({ error: "Missing Authorization Bearer token." });
      return;
    }
    const verified = await verifyFirebaseIdToken(token);
    req.userId = verified.uid;
    req.userEmail = verified.email;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    res.status(401).json({ error: message });
  }
}

function sanitizeSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "item";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 20,
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "30mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Extract & OCR uploaded files (PDF, DOCX, PPTX, TXT, JPG/PNG)
  app.post(
    "/api/materials/extract",
    requireAuth,
    upload.array("files", 20),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const subjectId = String(req.body?.subjectId || "").trim();
        if (!subjectId || !/^[a-zA-Z0-9_-]{1,128}$/.test(subjectId)) {
          res.status(400).json({ error: "Valid subjectId is required." });
          return;
        }

        const files = (req.files as Express.Multer.File[]) || [];
        if (files.length === 0) {
          res.status(400).json({ error: "No files uploaded." });
          return;
        }

        const ai = createGeminiClient();
        const safeUid = sanitizeSegment(req.userId || "user");
        const safeSubject = sanitizeSegment(subjectId);
        const subjectDir = path.resolve(UPLOADS_ROOT, safeUid, safeSubject);
        if (!subjectDir.startsWith(UPLOADS_ROOT + path.sep)) {
          res.status(400).json({ error: "Invalid upload path." });
          return;
        }
        fs.mkdirSync(subjectDir, { recursive: true });

        const results = [];
        for (const file of files) {
          const uniquePrefix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
          const safeFileName = `${uniquePrefix}_${sanitizeSegment(file.originalname)}`;
          const diskPath = path.resolve(subjectDir, safeFileName);
          if (!diskPath.startsWith(subjectDir + path.sep)) {
            throw new Error("Path confinement check failed.");
          }
          fs.writeFileSync(diskPath, file.buffer);

          const extracted = await extractMaterialContent(ai, {
            originalname: file.originalname,
            mimetype: file.mimetype,
            buffer: file.buffer,
          });

          const chunks = splitIntoChunks(extracted.extractedText);
          results.push({
            fileName: extracted.fileName,
            fileType: extracted.fileType,
            mimeType: extracted.mimeType,
            fileSize: file.size,
            storagePath: `/api/files/${encodeURIComponent(safeSubject)}/${encodeURIComponent(
              safeFileName
            )}`,
            extractedCharCount: extracted.extractedText.length,
            pageCount: extracted.pageCount,
            ocrUsed: extracted.ocrUsed,
            summary: extracted.summary,
            chunks,
          });
        }

        res.json({ materials: results });
      } catch (err) {
        const message = formatFriendlyAiError(err);
        console.error("Material extraction error:", message);
        res.status(isDailyQuotaError(err) ? 429 : 500).json({ error: message });
      }
    }
  );

  // Download previously uploaded file (authenticated owner only)
  app.get(
    "/api/files/:subjectId/:storedFile",
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const safeUid = sanitizeSegment(req.userId || "user");
        const safeSubject = sanitizeSegment(String(req.params.subjectId || ""));
        const safeFile = sanitizeSegment(String(req.params.storedFile || ""));
        const subjectDir = path.resolve(UPLOADS_ROOT, safeUid, safeSubject);
        const filePath = path.resolve(subjectDir, safeFile);

        if (!filePath.startsWith(subjectDir + path.sep) || !fs.existsSync(filePath)) {
          res.status(404).json({ error: "File not found." });
          return;
        }
        res.sendFile(filePath);
      } catch {
        res.status(404).json({ error: "File not found." });
      }
    }
  );

  // Streaming SSE endpoint: Analyze full course + build content map + extract professor questions + generate 300-400+ questions
  app.post(
    "/api/courses/analyze-stream",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const sendEvent = (event: string, data: unknown) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        const {
          subjectId,
          subjectName,
          courseCode,
          materials,
          targetCount = 320,
          existingPrompts = [],
        } = req.body as {
          subjectId?: string;
          subjectName?: string;
          courseCode?: string;
          materials?: (CourseMaterialInput & {
            fileType?: string;
            storagePath?: string;
          })[];
          targetCount?: number;
          existingPrompts?: string[];
        };

        if (!subjectName || !courseCode || !Array.isArray(materials) || materials.length === 0) {
          sendEvent("error", { message: "Subject details and uploaded materials are required." });
          res.end();
          return;
        }

        const ai = createGeminiClient();
        const safeTarget = Math.max(60, Math.min(450, Math.round(Number(targetCount) || 320)));

        const seenPrompts = new Set<string>(
          (existingPrompts || []).map((p) =>
            String(p).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()
          )
        );
        const promptSamples: string[] = [...(existingPrompts || [])];

        let totalGenerated = 0;
        let professorCount = 0;
        let lectureCount = 0;
        let aiGeneratedCount = 0;
        const visualPrompts: string[] = [];

        if (subjectId && /^[a-zA-Z0-9_-]{1,128}$/.test(subjectId)) {
          const safeUid = sanitizeSegment(req.userId || "user");
          const safeSubject = sanitizeSegment(subjectId);
          const subjectDir = path.resolve(UPLOADS_ROOT, safeUid, safeSubject);

          if (subjectDir.startsWith(UPLOADS_ROOT + path.sep) && fs.existsSync(subjectDir)) {
            cleanOldSubjectCrops(subjectDir);
            sendEvent("stage", {
              stage: "visuals",
              message: "Scanning uploaded PDFs, slides & images for questions with diagrams...",
              progressPct: 5,
            });

            const visualQuestions = await extractVisualQuestionsFromCourseFiles(ai, {
              subjectName,
              courseCode,
              subjectDir,
              safeSubject,
              materials,
              onProgress: (msg) => {
                sendEvent("stage", {
                  stage: "visuals",
                  message: msg,
                  progressPct: 8,
                });
              },
            });

            const acceptedVisuals = deduplicateQuestions(seenPrompts, visualQuestions);
            for (const vq of acceptedVisuals) {
              promptSamples.push(vq.prompt);
              visualPrompts.push(vq.prompt);
              totalGenerated += 1;
              if (vq.source === "Professor") professorCount += 1;
              else if (vq.source === "Lecture") lectureCount += 1;
              else aiGeneratedCount += 1;
            }

            if (acceptedVisuals.length > 0) {
              sendEvent("questions", {
                questions: acceptedVisuals,
                totalGenerated,
                targetCount: safeTarget,
              });
            }
          }
        }

        sendEvent("stage", {
          stage: "mapping",
          message: `Reading ${materials.length} course file(s), extracting professor questions, and building the course content map...`,
          progressPct: 14,
        });

        const stage1 = await analyzeCourseMapAndProfessorQuestions(
          ai,
          subjectName,
          courseCode,
          materials,
          visualPrompts
        );

        sendEvent("contentMap", {
          courseSummary: stage1.courseSummary,
          nodes: stage1.contentMap,
        });

        const initialQuestions = deduplicateQuestions(seenPrompts, stage1.extractedQuestions);
        initialQuestions.forEach((q) => {
          promptSamples.push(q.prompt);
          totalGenerated += 1;
          if (q.source === "Professor") professorCount += 1;
          else if (q.source === "Lecture") lectureCount += 1;
          else aiGeneratedCount += 1;
        });

        if (initialQuestions.length > 0) {
          sendEvent("questions", {
            questions: initialQuestions,
            totalGenerated,
            targetCount: safeTarget,
          });
        }

        const nodes =
          stage1.contentMap.length > 0
            ? stage1.contentMap
            : [
                {
                  lecture: "Course Overview",
                  topic: subjectName,
                  subtopics: [],
                  definitions: [],
                  formulas: [],
                  examples: [],
                  sourceFiles: materials.map((m) => m.fileName),
                },
              ];

        // Determine total batches needed to reach safeTarget (~55 questions per batch to stay well within free-tier RPD limits)
        const remainingNeeded = Math.max(0, safeTarget - totalGenerated);
        const batchSize = 55;
        const plannedBatches = Math.max(1, Math.ceil(remainingNeeded / batchSize));
        // Cap max batches to avoid runaway loops on tiny files
        const totalChars = materials.reduce((acc, m) => acc + m.text.length, 0);
        const maxReasonableBatches = totalChars < 1500 ? 2 : Math.min(7, plannedBatches + 1);
        const batchCount = Math.min(plannedBatches, maxReasonableBatches);

        let consecutiveLowYield = 0;
        let quotaWarning: string | null = null;

        for (let b = 0; b < batchCount && totalGenerated < safeTarget; b += 2) {
          const waveIndices = [b];
          if (b + 1 < batchCount && totalGenerated + batchSize < safeTarget) {
            waveIndices.push(b + 1);
          }

          sendEvent("stage", {
            stage: "generating",
            message: `Synthesizing multi-format questions (Batch ${b + 1}${
              waveIndices.length > 1 ? `–${b + 2}` : ""
            } of ${batchCount}) · ${totalGenerated} / ${safeTarget} ready`,
            progressPct: Math.min(94, 20 + Math.round(((b + 1) / batchCount) * 74)),
          });

          const waveSettled = await Promise.allSettled(
            waveIndices.map((idx) => {
              const startNode = Math.floor((idx * nodes.length) / batchCount);
              const endNode = Math.max(
                startNode + 1,
                Math.ceil(((idx + 1) * nodes.length) / batchCount)
              );
              const focusNodes = nodes.slice(startNode, endNode);
              const neededNow = Math.min(
                batchSize,
                Math.max(20, safeTarget - totalGenerated)
              );
              return generateQuestionBatchForTopics(ai, {
                subjectName,
                courseCode,
                materials,
                focusNodes: focusNodes.length > 0 ? focusNodes : nodes,
                batchSize: neededNow,
                batchIndex: idx,
                totalBatches: batchCount,
                existingPromptSamples: promptSamples,
                preferredSource: idx < Math.ceil(batchCount / 2) ? "Lecture" : "AI Generated",
              });
            })
          );

          let waveAddedCount = 0;
          const waveAccepted: GeneratedQuestionOutput[] = [];
          let waveHitQuota = false;

          for (const outcome of waveSettled) {
            if (outcome.status !== "fulfilled") {
              console.warn("Question batch wave item failed:", outcome.reason);
              if (isDailyQuotaError(outcome.reason)) {
                waveHitQuota = true;
                quotaWarning = formatFriendlyAiError(outcome.reason);
              }
              continue;
            }
            const unique = deduplicateQuestions(seenPrompts, outcome.value);
            for (const q of unique) {
              if (totalGenerated >= safeTarget + 40) break;
              promptSamples.push(q.prompt);
              waveAccepted.push(q);
              totalGenerated += 1;
              waveAddedCount += 1;
              if (q.source === "Professor") professorCount += 1;
              else if (q.source === "Lecture") lectureCount += 1;
              else aiGeneratedCount += 1;
            }
          }

          if (waveAccepted.length > 0) {
            sendEvent("questions", {
              questions: waveAccepted,
              totalGenerated,
              targetCount: safeTarget,
            });
          }

          if (waveHitQuota) {
            break;
          }

          if (waveAddedCount < 8) {
            consecutiveLowYield += 1;
            if (consecutiveLowYield >= 2) break;
          } else {
            consecutiveLowYield = 0;
          }
        }

        if (quotaWarning && totalGenerated === 0) {
          sendEvent("error", { message: quotaWarning });
          res.end();
          return;
        }

        sendEvent("complete", {
          totalQuestions: totalGenerated,
          professorCount,
          lectureCount,
          aiGeneratedCount,
          courseSummary: quotaWarning
            ? `${stage1.courseSummary}\n\n[Note: ${totalGenerated} questions were saved before hitting the daily Free Tier API quota limit.]`
            : stage1.courseSummary,
        });
        res.end();
      } catch (err) {
        const message = formatFriendlyAiError(err);
        console.error("Course analysis stream error:", message);
        sendEvent("error", { message });
        res.end();
      }
    }
  );

  // Evaluate student answer (semantic + numerical grading via Gemini)
  app.post(
    "/api/questions/evaluate",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { questionPrompt, questionType, correctAnswer, explanation, userAnswer } =
          req.body as {
            questionPrompt?: string;
            questionType?: QuestionType;
            correctAnswer?: string;
            explanation?: string;
            userAnswer?: string;
          };

        if (!questionPrompt || !questionType || !correctAnswer) {
          res.status(400).json({ error: "Question details are required." });
          return;
        }

        const ai = createGeminiClient();
        const result = await evaluateFreeformAnswer(ai, {
          questionPrompt,
          questionType,
          correctAnswer,
          explanation: explanation || "",
          userAnswer: String(userAnswer || ""),
        });

        res.json(result);
      } catch (err) {
        const message = formatFriendlyAiError(err);
        res.status(isDailyQuotaError(err) ? 429 : 500).json({ error: message });
      }
    }
  );

  // Ensure unmatched /api/* routes always return JSON instead of SPA HTML
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "API route not found." });
  });

  // Ensure Multer & server errors on /api/* always return JSON instead of Express HTML
  app.use(
    (err: unknown, req: Request, res: Response, next: NextFunction): void => {
      if (req.path.startsWith("/api")) {
        if (err instanceof multer.MulterError) {
          const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
          res.status(status).json({
            error:
              err.code === "LIMIT_FILE_SIZE"
                ? "File exceeds the 30 MB upload limit."
                : err.message,
          });
          return;
        }
        const message =
          err instanceof Error ? err.message : "Unexpected server error.";
        res.status(500).json({ error: message });
        return;
      }
      next(err);
    }
  );

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CourseBank server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
