import crypto from "crypto";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import sharp from "sharp";
import { getDocumentProxy, getResolvedPDFJS, renderPageAsImage } from "unpdf";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { generateWithModelFallback, isDailyQuotaError } from "./aiHelper.ts";
import { GeneratedQuestionOutput, QuestionType } from "./geminiCourseAi.ts";

export interface VisualSourceMaterial {
  fileName: string;
  folder: string;
  fileType?: string;
  storagePath?: string;
}

interface VisualPageTarget {
  fileName: string;
  folder: string;
  pageLabel: string;
  sourceRef: string;
  extraTextContext?: string;
  pngBuffer: Buffer;
}

interface RawVisualQuestion {
  imageIndex?: number;
  box_2d?: number[];
  lecture?: string;
  topic?: string;
  type?: string;
  difficulty?: string;
  source?: string;
  sourceRef?: string;
  caption?: string;
  prompt?: string;
  options?: string[];
  matchingPairs?: string[];
  correctAnswer?: string;
  explanation?: string;
}

const VALID_TYPES = new Set<QuestionType>([
  "mcq",
  "true_false",
  "complete",
  "short_answer",
  "essay",
  "numerical",
  "matching",
]);

function sanitizeSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "item";
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

export function cleanOldSubjectCrops(subjectDir: string): void {
  if (!fs.existsSync(subjectDir)) return;
  try {
    const entries = fs.readdirSync(subjectDir);
    for (const entry of entries) {
      if (entry.startsWith("crop_") && entry.endsWith(".png")) {
        const target = path.resolve(subjectDir, entry);
        if (target.startsWith(subjectDir + path.sep)) {
          fs.unlinkSync(target);
        }
      }
    }
  } catch (err) {
    console.warn("Could not clean old subject crops:", err);
  }
}

function resolveMaterialDiskPath(
  subjectDir: string,
  storagePath?: string
): string | null {
  if (!storagePath) return null;
  const parts = storagePath.split("/").filter(Boolean);
  const rawFile = parts[parts.length - 1];
  if (!rawFile) return null;
  let decoded = rawFile;
  try {
    decoded = decodeURIComponent(rawFile);
  } catch {
    decoded = rawFile;
  }
  const safeFile = sanitizeSegment(decoded);
  const diskPath = path.resolve(subjectDir, safeFile);
  if (!diskPath.startsWith(subjectDir + path.sep)) return null;
  if (!fs.existsSync(diskPath)) return null;
  return diskPath;
}

async function collectPdfVisualTargets(
  mat: VisualSourceMaterial,
  pdfBuffer: Buffer
): Promise<VisualPageTarget[]> {
  const targets: VisualPageTarget[] = [];
  const pdfProxy = await getDocumentProxy(new Uint8Array(pdfBuffer));

  try {
    const { OPS } = await getResolvedPDFJS();
    const totalPages = pdfProxy.numPages;

    const imageOpCodes = new Set<number>([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
      OPS.paintImageXObjectRepeat,
      OPS.paintInlineImageXObjectGroup,
    ]);
    const drawOpCodes = new Set<number>([
      OPS.stroke,
      OPS.closeStroke,
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
      OPS.constructPath,
    ]);

    const visualKeywordRegex =
      /\b(figure|fig\.?|diagram|circuit|graph|plot|sketch|shown|below|above|waveform|schematic|flowchart|question|problem|exercise|example|table|draw)\b|رسم|الشكل|موضح|مسألة|سؤال|الدائرة/i;

    const scoredPages: { pageNum: number; score: number; text: string }[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdfProxy.getPage(pageNum);
        const [opList, textContent] = await Promise.all([
          page.getOperatorList(),
          page.getTextContent(),
        ]);

        let imageOps = 0;
        let drawOps = 0;
        for (const fn of opList.fnArray) {
          if (imageOpCodes.has(fn)) imageOps += 1;
          else if (drawOpCodes.has(fn)) drawOps += 1;
        }

        const pageText = textContent.items
          .map((item) => ("str" in item ? String(item.str || "") : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        const hasKeyword = visualKeywordRegex.test(pageText);
        const isScannedPage = pageText.length < 40 && imageOps > 0;
        const isCandidate =
          imageOps > 0 || drawOps >= 10 || hasKeyword || isScannedPage;

        if (isCandidate) {
          const score =
            (hasKeyword ? 12 : 0) +
            Math.min(10, imageOps * 3) +
            (drawOps >= 15 ? 8 : drawOps >= 10 ? 4 : 0) +
            (isScannedPage ? 5 : 0);
          scoredPages.push({ pageNum, score, text: pageText });
        }
      } catch {
        // Ignore single-page inspection failures
      }
    }

    // Prioritize top 12 visual candidate pages (3 batched Vision API calls max), then restore ascending order
    const selected = scoredPages
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .sort((a, b) => a.pageNum - b.pageNum);

    for (const item of selected) {
      try {
        const arrayBuf = await renderPageAsImage(pdfProxy, item.pageNum, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale: 2,
          format: "png",
        });
        const pngBuffer = Buffer.from(arrayBuf);
        targets.push({
          fileName: mat.fileName,
          folder: mat.folder,
          pageLabel: `Page ${item.pageNum}`,
          sourceRef: `${mat.fileName}, Page ${item.pageNum}`,
          extraTextContext: item.text.slice(0, 2000),
          pngBuffer,
        });
      } catch (err) {
        console.warn(`Failed rendering ${mat.fileName} page ${item.pageNum}:`, err);
      }
    }
  } finally {
    try {
      await pdfProxy.loadingTask.destroy();
    } catch {
      // Ignore cleanup error
    }
  }

  return targets;
}

async function collectPptxVisualTargets(
  mat: VisualSourceMaterial,
  pptxBuffer: Buffer
): Promise<VisualPageTarget[]> {
  const targets: VisualPageTarget[] = [];
  const zip = await JSZip.loadAsync(pptxBuffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      return numA - numB;
    });

  for (const slidePath of slidePaths) {
    if (targets.length >= 16) break;
    const slideNum = slidePath.match(/slide(\d+)\.xml/i)?.[1] || "?";
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    if (!zip.files[relsPath]) continue;

    const slideXml = await zip.files[slidePath].async("string");
    const slideText = [...slideXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXmlEntities(m[1]).trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const relsXml = await zip.files[relsPath].async("string");
    const mediaTargets = [
      ...relsXml.matchAll(/Target="([^"]*media\/[^"]+\.(?:png|jpg|jpeg|webp))"/gi),
    ].map((m) => m[1]);

    for (const relTarget of mediaTargets) {
      if (targets.length >= 16) break;
      const normalizedZipPath = relTarget.startsWith("../")
        ? `ppt/${relTarget.slice(3)}`
        : relTarget.startsWith("/")
          ? relTarget.slice(1)
          : `ppt/slides/${relTarget}`;
      const zipFile = zip.files[normalizedZipPath];
      if (!zipFile) continue;

      const rawBuf = await zipFile.async("nodebuffer");
      // Skip tiny icon/logo assets under 6 KB
      if (rawBuf.byteLength < 6000) continue;

      try {
        const meta = await sharp(rawBuf).metadata();
        if ((meta.width || 0) < 140 || (meta.height || 0) < 100) continue;
        const pngBuffer = await sharp(rawBuf).rotate().png().toBuffer();
        targets.push({
          fileName: mat.fileName,
          folder: mat.folder,
          pageLabel: `Slide ${slideNum}`,
          sourceRef: `${mat.fileName}, Slide ${slideNum}`,
          extraTextContext: slideText.slice(0, 2000),
          pngBuffer,
        });
      } catch {
        // Ignore unsupported/corrupt embedded image
      }
    }
  }

  return targets;
}

const VISUAL_QUESTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    visualQuestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          imageIndex: {
            type: Type.INTEGER,
            description:
              "0-based index of the attached image in this batch where the diagram/question appears (0, 1, 2, or 3).",
          },
          box_2d: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description:
              "Bounding box [ymin, xmin, ymax, xmax] in normalized 0..1000 coordinates of that specific image enclosing the question WITH its diagram/figure intact (include labels, axes, values, and question text shown in the image).",
          },
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
            description:
              "'Professor' if an explicit question/exercise/problem is printed on the page, or 'Lecture' if derived from a lecture diagram/example figure.",
          },
          sourceRef: { type: Type.STRING },
          caption: {
            type: Type.STRING,
            description: "Concise caption describing what the cropped diagram/question shows.",
          },
          prompt: {
            type: Type.STRING,
            description:
              "Clear complete question prompt referencing the attached figure (preserve verbatim professor wording when printed).",
          },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          matchingPairs: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          correctAnswer: { type: Type.STRING },
          explanation: {
            type: Type.STRING,
            description:
              "Detailed step-by-step solution reading exact values/components/curves from the diagram (Given -> Formula -> Step-by-Step Calculation with units -> Final Answer, or complete reasoning).",
          },
        },
        required: [
          "imageIndex",
          "box_2d",
          "lecture",
          "topic",
          "type",
          "difficulty",
          "source",
          "sourceRef",
          "caption",
          "prompt",
          "options",
          "matchingPairs",
          "correctAnswer",
          "explanation",
        ],
      },
    },
  },
  required: ["visualQuestions"],
};

async function detectAndCropBatch(
  ai: GoogleGenAI,
  subjectName: string,
  courseCode: string,
  subjectDir: string,
  safeSubject: string,
  batchTargets: VisualPageTarget[]
): Promise<GeneratedQuestionOutput[]> {
  if (batchTargets.length === 0) return [];

  const targetMeta = await Promise.all(
    batchTargets.map(async (t) => {
      const m = await sharp(t.pngBuffer).metadata();
      return {
        target: t,
        imgW: m.width || 0,
        imgH: m.height || 0,
      };
    })
  );

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  batchTargets.forEach((t, idx) => {
    parts.push({
      text: `IMAGE ${idx}: File "${t.fileName}" (${t.pageLabel}, Folder: ${t.folder})${
        t.extraTextContext ? `\nText Context: ${t.extraTextContext.slice(0, 900)}` : ""
      }`,
    });
    parts.push({
      inlineData: {
        mimeType: "image/png",
        data: t.pngBuffer.toString("base64"),
      },
    });
  });

  parts.push({
    text: `Inspect ALL ${batchTargets.length} attached images (IMAGE 0 to IMAGE ${
      batchTargets.length - 1
    }) for course "${courseCode}: ${subjectName}".
Find EVERY question, problem, exercise, or worked example across these images that contains or relies on a DIAGRAM, CIRCUIT, GRAPH, PLOT, WAVEFORM, GEOMETRIC DRAWING, FREE-BODY DIAGRAM, FLOWCHART, BLOCK DIAGRAM, or VISUAL FIGURE.
Also, if an image shows a substantive scientific/engineering diagram or labeled figure (not a decorative university logo, watermark, or blank border) without a printed question, crop the diagram cleanly and create an exam question testing that figure.

IGNORE:
- Pure text-only pages/paragraphs with NO diagram or visual figure.
- Decorative logos, page headers/footers, or tiny icons.

CROPPING RULES (CRITICAL):
- Set "imageIndex" to the 0-based index (0..${batchTargets.length - 1}) of the image containing the figure.
- Return "box_2d": [ymin, xmin, ymax, xmax] as integers in normalized 0..1000 coordinates of THAT specific image.
- Crop the question-with-diagram AS IT APPEARS in the file so the student can view the exact original drawing and solve it (include BOTH question stem/values AND the full diagram when they appear together, and never clip axis labels, resistor values, arrows, or units).

SOLUTION RULES (CRITICAL):
- Read every numeric value, symbol, polarity, axis tick, and label directly from the visual diagram.
- Provide a thorough, clear step-by-step explanation showing how to solve it (Given -> Formula -> Step-by-Step Calculation with units -> Final Answer, or complete conceptual reasoning).`,
  });

  const response = await generateWithModelFallback(ai, {
    contents: { parts },
    thinkingLevel: ThinkingLevel.LOW,
    responseMimeType: "application/json",
    responseSchema: VISUAL_QUESTION_SCHEMA,
  });

  const parsed = JSON.parse((response.text || "{}").trim()) as {
    visualQuestions?: RawVisualQuestion[];
  };

  const results: GeneratedQuestionOutput[] = [];
  const items = parsed.visualQuestions || [];

  for (const item of items) {
    const rawIdx = Number(item.imageIndex ?? 0);
    const chosen =
      Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < targetMeta.length
        ? targetMeta[rawIdx]
        : targetMeta[0];
    if (!chosen || chosen.imgW < 80 || chosen.imgH < 80) continue;

    const { target, imgW, imgH } = chosen;

    const prompt = String(item.prompt || "").trim().slice(0, 3900);
    const correctAnswer = String(item.correctAnswer || "").trim().slice(0, 3900);
    const explanation = String(item.explanation || "").trim().slice(0, 5800);
    if (!prompt || !correctAnswer) continue;

    const rawBox = Array.isArray(item.box_2d) ? item.box_2d : [];
    if (rawBox.length !== 4) continue;

    const ymin = Number(rawBox[0]);
    const xmin = Number(rawBox[1]);
    const ymax = Number(rawBox[2]);
    const xmax = Number(rawBox[3]);
    if (
      !Number.isFinite(ymin) ||
      !Number.isFinite(xmin) ||
      !Number.isFinite(ymax) ||
      !Number.isFinite(xmax)
    ) {
      continue;
    }

    if (ymax - ymin < 45 || xmax - xmin < 50) continue;

    // Add 1.6% normalized padding so border labels and arrows are never clipped
    const pad = 16;
    const y0 = Math.max(0, ymin - pad);
    const x0 = Math.max(0, xmin - pad);
    const y1 = Math.min(1000, ymax + pad);
    const x1 = Math.min(1000, xmax + pad);

    const left = Math.max(0, Math.floor((x0 / 1000) * imgW));
    const top = Math.max(0, Math.floor((y0 / 1000) * imgH));
    const right = Math.min(imgW, Math.ceil((x1 / 1000) * imgW));
    const bottom = Math.min(imgH, Math.ceil((y1 / 1000) * imgH));
    const cropWidth = right - left;
    const cropHeight = bottom - top;

    if (cropWidth < 40 || cropHeight < 35) continue;

    const cropBuffer = await sharp(target.pngBuffer)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .png({ compressionLevel: 8 })
      .toBuffer();

    const cropFileName = `crop_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.png`;
    const cropDiskPath = path.resolve(subjectDir, cropFileName);
    if (!cropDiskPath.startsWith(subjectDir + path.sep)) continue;
    fs.writeFileSync(cropDiskPath, cropBuffer);

    const figureUrl = `/api/files/${encodeURIComponent(safeSubject)}/${encodeURIComponent(
      cropFileName
    )}`;

    const qType: QuestionType = VALID_TYPES.has(item.type as QuestionType)
      ? (item.type as QuestionType)
      : "short_answer";
    const difficulty =
      item.difficulty === "Easy" || item.difficulty === "Medium" || item.difficulty === "Hard"
        ? item.difficulty
        : "Medium";
    const source = item.source === "Professor" ? "Professor" : "Lecture";

    let options = Array.isArray(item.options)
      ? item.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 10)
      : [];
    if (qType === "true_false") {
      options = ["True", "False"];
    } else if (qType === "mcq" && options.length < 2) {
      continue;
    }

    const matchingPairs = Array.isArray(item.matchingPairs)
      ? item.matchingPairs.map((p) => String(p).trim()).filter(Boolean).slice(0, 10)
      : [];
    if (qType === "matching" && matchingPairs.length < 2) {
      continue;
    }

    results.push({
      lecture:
        String(item.lecture || target.folder || "Course Diagrams")
          .trim()
          .slice(0, 145) || "Course Diagrams",
      topic: String(item.topic || "Visual Problem").trim().slice(0, 195) || "Visual Problem",
      type: qType,
      difficulty,
      source,
      sourceRef:
        String(item.sourceRef || target.sourceRef).trim().slice(0, 290) || target.sourceRef,
      prompt,
      options,
      matchingPairs,
      correctAnswer,
      explanation: explanation || `Verified directly from figure in ${target.sourceRef}.`,
      figureUrl,
      figureCaption: String(item.caption || `Diagram from ${target.sourceRef}`)
        .trim()
        .slice(0, 290),
    });
  }

  return results;
}

export async function extractVisualQuestionsFromCourseFiles(
  ai: GoogleGenAI,
  params: {
    subjectName: string;
    courseCode: string;
    subjectDir: string;
    safeSubject: string;
    materials: VisualSourceMaterial[];
    onProgress?: (message: string) => void;
  }
): Promise<GeneratedQuestionOutput[]> {
  const { subjectName, courseCode, subjectDir, safeSubject, materials, onProgress } = params;
  const allTargets: VisualPageTarget[] = [];

  for (const mat of materials) {
    const diskPath = resolveMaterialDiskPath(subjectDir, mat.storagePath);
    if (!diskPath) continue;

    const lower = mat.fileName.toLowerCase();
    const fileType =
      mat.fileType ||
      (lower.endsWith(".pdf")
        ? "pdf"
        : lower.endsWith(".pptx")
          ? "pptx"
          : /\.(png|jpg|jpeg|webp)$/i.test(lower)
            ? "image"
            : "other");

    try {
      const buf = fs.readFileSync(diskPath);
      if (fileType === "image") {
        const pngBuffer = await sharp(buf).rotate().png().toBuffer();
        allTargets.push({
          fileName: mat.fileName,
          folder: mat.folder,
          pageLabel: "Image",
          sourceRef: mat.fileName,
          pngBuffer,
        });
      } else if (fileType === "pdf") {
        if (onProgress) {
          onProgress(`Scanning "${mat.fileName}" for pages containing diagrams & figures...`);
        }
        const pdfTargets = await collectPdfVisualTargets(mat, buf);
        allTargets.push(...pdfTargets);
      } else if (fileType === "pptx") {
        if (onProgress) {
          onProgress(`Inspecting slides in "${mat.fileName}" for diagrams & figures...`);
        }
        const pptxTargets = await collectPptxVisualTargets(mat, buf);
        allTargets.push(...pptxTargets);
      }
    } catch (err) {
      console.warn(`Visual inspection skipped for ${mat.fileName}:`, err);
    }
  }

  if (allTargets.length === 0) return [];

  // Batch up to 4 pages per single Vision API call (max 16 targets total = max 4 Vision API calls)
  const cappedTargets = allTargets.slice(0, 16);
  const PAGES_PER_CALL = 4;
  const visualQuestions: GeneratedQuestionOutput[] = [];

  for (let i = 0; i < cappedTargets.length; i += PAGES_PER_CALL) {
    const batch = cappedTargets.slice(i, i + PAGES_PER_CALL);
    if (onProgress) {
      onProgress(
        `Cropping diagram questions from course files (${Math.min(
          i + batch.length,
          cappedTargets.length
        )} of ${cappedTargets.length} visual pages)...`
      );
    }

    try {
      const batchQuestions = await detectAndCropBatch(
        ai,
        subjectName,
        courseCode,
        subjectDir,
        safeSubject,
        batch
      );
      visualQuestions.push(...batchQuestions);
    } catch (err) {
      console.warn("Visual batch extraction error:", err);
      if (isDailyQuotaError(err)) {
        // Stop further visual batches cleanly while preserving any already-cropped diagrams
        break;
      }
    }
  }

  return visualQuestions;
}
