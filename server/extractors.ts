import mammoth from "mammoth";
import JSZip from "jszip";
import sharp from "sharp";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { generateWithModelFallback } from "./aiHelper.ts";

export interface ExtractedMaterialResult {
  fileName: string;
  fileType: "pdf" | "docx" | "pptx" | "txt" | "image";
  mimeType: string;
  extractedText: string;
  pageCount: number;
  ocrUsed: boolean;
  summary: string;
}

export function detectFileType(
  fileName: string,
  mimeType: string
): "pdf" | "docx" | "pptx" | "txt" | "image" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    lower.endsWith(".docx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    lower.endsWith(".pptx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    mimeType.startsWith("image/")
  ) {
    return "image";
  }
  return "txt";
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

async function extractPptxText(
  buffer: Buffer
): Promise<{ text: string; slideCount: number }> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      return numA - numB;
    });

  const parts: string[] = [];

  for (const slidePath of slidePaths) {
    const slideNum = slidePath.match(/slide(\d+)\.xml/i)?.[1] || "?";
    const xml = await zip.files[slidePath].async("string");
    const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1]).trim()
    );
    const slideText = runs.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notesText = "";
    if (zip.files[notesPath]) {
      const notesXml = await zip.files[notesPath].async("string");
      const noteRuns = [...notesXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(
        (m) => decodeXmlEntities(m[1]).trim()
      );
      notesText = noteRuns
        .filter((t) => t && t !== slideNum)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (slideText || notesText) {
      let block = `[Slide ${slideNum}]\n${slideText}`;
      if (notesText) {
        block += `\n[Speaker Notes - Slide ${slideNum}]: ${notesText}`;
      }
      parts.push(block);
    }
  }

  return {
    text: parts.join("\n\n"),
    slideCount: slidePaths.length || 1,
  };
}

async function summarizeTextWithGemini(
  _ai: GoogleGenAI,
  fileName: string,
  text: string
): Promise<string> {
  // Build instant local preview without consuming Gemini API quota during upload
  const cleaned = text
    .replace(/\[(?:Page|Slide|Image)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return `Uploaded "${fileName}" — ready for AI course analysis.`;
  }
  return cleaned.length > 260 ? `${cleaned.slice(0, 257)}...` : cleaned;
}

async function extractBinaryWithGeminiOcr(
  ai: GoogleGenAI,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  fileType: "pdf" | "image",
  knownPageCount?: number
): Promise<{ text: string; pageCount: number; ocrUsed: boolean; summary: string }> {
  const prompt =
    fileType === "pdf"
      ? `You are a high-precision academic document OCR and text extractor. Read EVERY page of the attached PDF ("${fileName}") completely—including text, tables, slide bullets, equations, mathematical symbols, diagram labels, footnotes, handwritten annotations, and any questions or exercises written by the professor.
Output plain text formatted with [Page N] markers (e.g. "[Page 1]\\n...\\n[Page 2]\\n..."). Preserve every professor question, exercise, formula, and definition accurately.`
      : `You are a high-precision academic OCR engine. Transcribe ALL text, handwritten lecture notes, equations, formulas, diagrams, labels, and questions visible in this image ("${fileName}").
Format cleanly starting with "[Image: ${fileName}]" and preserve formulas, definitions, and any explicit questions verbatim.`;

  const base64 = buffer.toString("base64");
  const part = {
    inlineData: {
      mimeType,
      data: base64,
    },
  };

  const response = await generateWithModelFallback(ai, {
    contents: { parts: [part, { text: prompt }] },
    thinkingLevel: ThinkingLevel.LOW,
  });

  const text =
    (response.text || "").trim() || `[No readable text detected in ${fileName}]`;
  const pageMatches = [...text.matchAll(/\[Page\s+(\d+)\]/gi)];
  const detectedPages = pageMatches.length > 0 ? pageMatches.length : 1;
  const pageCount = knownPageCount || (fileType === "image" ? 1 : detectedPages);
  const summary = await summarizeTextWithGemini(ai, fileName, text);

  return {
    text,
    pageCount: Math.max(1, pageCount),
    ocrUsed: true,
    summary,
  };
}

async function extractNativePdf(
  buffer: Buffer
): Promise<{ text: string; pageCount: number; charsPerPage: number }> {
  const res = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = Array.isArray(res.text) ? res.text : [String(res.text || "")];
  const pageCount = Math.max(1, res.totalPages || pages.length || 1);
  const formattedPages = pages
    .map((pageText, idx) => {
      const cleaned = String(pageText || "").replace(/\s+/g, " ").trim();
      return cleaned ? `[Page ${idx + 1}]\n${cleaned}` : "";
    })
    .filter(Boolean);

  const combined = formattedPages.join("\n\n").trim();
  return {
    text: combined,
    pageCount,
    charsPerPage: combined.length / pageCount,
  };
}

async function extractScannedPdfByPageBatches(
  ai: GoogleGenAI,
  buffer: Buffer,
  fileName: string
): Promise<{ text: string; pageCount: number; ocrUsed: boolean; summary: string }> {
  const pdfProxy = await getDocumentProxy(new Uint8Array(buffer));
  const totalPages = pdfProxy.numPages || 1;
  const maxOcrPages = Math.min(totalPages, 36);
  const PAGES_PER_BATCH = 6;
  const pageTexts: string[] = [];

  try {
    for (let start = 1; start <= maxOcrPages; start += PAGES_PER_BATCH) {
      const end = Math.min(maxOcrPages, start + PAGES_PER_BATCH - 1);
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
        [];

      for (let p = start; p <= end; p++) {
        const rawPng = await renderPageAsImage(pdfProxy, p, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale: 1.5,
          format: "png",
        });
        const jpegBuf = await sharp(Buffer.from(rawPng))
          .jpeg({ quality: 82 })
          .toBuffer();
        parts.push({ text: `Page ${p}:` });
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: jpegBuf.toString("base64"),
          },
        });
      }

      parts.push({
        text: `Transcribe ALL text, handwritten notes, equations, formulas, diagram labels, and professor questions from these pages (${start} to ${end}) of "${fileName}".
Format clearly with [Page N] headers (e.g. "[Page ${start}]\\n..."). Preserve every question, equation, and definition verbatim.`,
      });

      const resp = await generateWithModelFallback(ai, {
        contents: { parts },
        thinkingLevel: ThinkingLevel.LOW,
      });
      if (resp.text?.trim()) {
        pageTexts.push(resp.text.trim());
      }
    }
  } finally {
    try {
      await pdfProxy.loadingTask.destroy();
    } catch {
      // Ignore cleanup error
    }
  }

  const combined =
    pageTexts.join("\n\n").trim() || `[No readable text detected in ${fileName}]`;
  const summary = await summarizeTextWithGemini(ai, fileName, combined);
  return {
    text: combined,
    pageCount: totalPages,
    ocrUsed: true,
    summary,
  };
}

export async function extractMaterialContent(
  ai: GoogleGenAI,
  file: { originalname: string; mimetype: string; buffer: Buffer }
): Promise<ExtractedMaterialResult> {
  const fileType = detectFileType(file.originalname, file.mimetype);

  if (fileType === "txt") {
    const text = file.buffer.toString("utf-8").trim();
    const summary = text
      ? await summarizeTextWithGemini(ai, file.originalname, text)
      : "Empty text file.";
    return {
      fileName: file.originalname,
      fileType: "txt",
      mimeType: file.mimetype || "text/plain",
      extractedText: text || `[Empty text file: ${file.originalname}]`,
      pageCount: Math.max(1, Math.ceil(text.length / 3000)),
      ocrUsed: false,
      summary,
    };
  }

  if (fileType === "docx") {
    const res = await mammoth.extractRawText({ buffer: file.buffer });
    const text = (res.value || "").trim();
    const summary = text
      ? await summarizeTextWithGemini(ai, file.originalname, text)
      : "Word document contained no extractable text.";
    return {
      fileName: file.originalname,
      fileType: "docx",
      mimeType:
        file.mimetype ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extractedText: text || `[No text extracted from ${file.originalname}]`,
      pageCount: Math.max(1, Math.ceil(text.length / 2800)),
      ocrUsed: false,
      summary,
    };
  }

  if (fileType === "pptx") {
    const { text, slideCount } = await extractPptxText(file.buffer);
    const summary = text
      ? await summarizeTextWithGemini(ai, file.originalname, text)
      : "PowerPoint presentation contained no extractable slide text.";
    return {
      fileName: file.originalname,
      fileType: "pptx",
      mimeType:
        file.mimetype ||
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extractedText: text || `[No slide text extracted from ${file.originalname}]`,
      pageCount: slideCount,
      ocrUsed: false,
      summary,
    };
  }

  if (fileType === "pdf") {
    let nativeResult: { text: string; pageCount: number; charsPerPage: number } | null = null;
    try {
      nativeResult = await extractNativePdf(file.buffer);
    } catch {
      nativeResult = null;
    }

    // Use instant native PDF text extraction whenever the PDF has embedded digital text
    if (
      nativeResult &&
      nativeResult.text.length >= 120 &&
      nativeResult.charsPerPage >= 50
    ) {
      const summary = await summarizeTextWithGemini(
        ai,
        file.originalname,
        nativeResult.text
      );
      return {
        fileName: file.originalname,
        fileType: "pdf",
        mimeType: "application/pdf",
        extractedText: nativeResult.text,
        pageCount: nativeResult.pageCount,
        ocrUsed: false,
        summary,
      };
    }

    // Scanned/image-based PDF: for > 4 MB scanned PDFs, use lightweight compressed JPEG page batches
    // so Gemini isn't hit with a massive 10–25 MB inline binary payload.
    const ocrRes =
      file.buffer.byteLength > 4 * 1024 * 1024
        ? await extractScannedPdfByPageBatches(ai, file.buffer, file.originalname)
        : await extractBinaryWithGeminiOcr(
            ai,
            file.buffer,
            "application/pdf",
            file.originalname,
            "pdf",
            nativeResult?.pageCount
          );

    return {
      fileName: file.originalname,
      fileType: "pdf",
      mimeType: "application/pdf",
      extractedText: ocrRes.text,
      pageCount: ocrRes.pageCount,
      ocrUsed: true,
      summary: ocrRes.summary,
    };
  }

  const normalizedMime =
    file.mimetype && file.mimetype.startsWith("image/")
      ? file.mimetype
      : file.originalname.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg";

  const ocrRes = await extractBinaryWithGeminiOcr(
    ai,
    file.buffer,
    normalizedMime,
    file.originalname,
    "image"
  );

  return {
    fileName: file.originalname,
    fileType: "image",
    mimeType: normalizedMime,
    extractedText: ocrRes.text,
    pageCount: 1,
    ocrUsed: true,
    summary: ocrRes.summary,
  };
}

export function splitIntoChunks(
  text: string,
  chunkSize = 180000
): { chunkIndex: number; pageRange: string; text: string }[] {
  const clean = text.trim();
  if (!clean) {
    return [{ chunkIndex: 0, pageRange: "All", text: "[Empty document]" }];
  }
  const chunks: { chunkIndex: number; pageRange: string; text: string }[] = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    const slice = clean.slice(i, i + chunkSize);
    const matches = [...slice.matchAll(/\[(?:Page|Slide)\s+(\d+)\]/g)];
    const first = matches[0]?.[1];
    const last = matches[matches.length - 1]?.[1];
    const pageRange =
      first && last
        ? first === last
          ? `Page/Slide ${first}`
          : `Pages/Slides ${first}-${last}`
        : `Segment ${chunks.length + 1}`;
    chunks.push({
      chunkIndex: chunks.length,
      pageRange,
      text: slice,
    });
  }
  return chunks;
}
