import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { User } from "firebase/auth";
import { db, handleFirestoreError, OperationType } from "./firebase";
import {
  ContentMapNode,
  CourseMaterial,
  ExamSimulation,
  MaterialChunk,
  MaterialFileType,
  QuestionAttempt,
  QuestionItem,
  Subject,
} from "../types/course";

function generateDocId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export async function upsertUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    const displayName = (user.displayName || user.email || "Student").slice(0, 120);
    const email = (user.email || "").slice(0, 200);
    const photoUrl = (user.photoURL || "").slice(0, 500);

    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        displayName,
        email,
        photoUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        email,
        photoUrl,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeToSubjects(
  ownerId: string,
  onData: (subjects: Subject[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const q = query(collection(db, "subjects"), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Subject[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Subject, "id">),
      }));
      items.sort((a, b) => {
        const tA = a.updatedAt?.seconds || 0;
        const tB = b.updatedAt?.seconds || 0;
        return tB - tA;
      });
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, "subjects");
    }
  );
}

export async function createSubject(
  ownerId: string,
  input: {
    name: string;
    courseCode: string;
    professorName: string;
    description: string;
    colorAccent: string;
  }
): Promise<string> {
  const id = generateDocId("sub");
  const path = `subjects/${id}`;
  try {
    await setDoc(doc(db, "subjects", id), {
      ownerId,
      name: input.name.trim().slice(0, 120),
      courseCode: input.courseCode.trim().toUpperCase().slice(0, 32),
      professorName: input.professorName.trim().slice(0, 100),
      description: input.description.trim().slice(0, 500),
      colorAccent: input.colorAccent.slice(0, 32),
      analysisStatus: "idle",
      analysisSummary: "",
      materialCount: 0,
      questionCount: 0,
      answeredCount: 0,
      correctCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSubjectDetails(
  subjectId: string,
  input: {
    name: string;
    courseCode: string;
    professorName: string;
    description: string;
    colorAccent: string;
  }
): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    await updateDoc(doc(db, "subjects", subjectId), {
      name: input.name.trim().slice(0, 120),
      courseCode: input.courseCode.trim().toUpperCase().slice(0, 32),
      professorName: input.professorName.trim().slice(0, 100),
      description: input.description.trim().slice(0, 500),
      colorAccent: input.colorAccent.slice(0, 32),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateSubjectAnalysis(
  subjectId: string,
  patch: {
    analysisStatus: "idle" | "analyzing" | "completed" | "error";
    analysisSummary: string;
    questionCount: number;
    materialCount: number;
  }
): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    await updateDoc(doc(db, "subjects", subjectId), {
      analysisStatus: patch.analysisStatus,
      analysisSummary: patch.analysisSummary.slice(0, 2500),
      questionCount: Math.max(0, Math.round(patch.questionCount)),
      materialCount: Math.max(0, Math.round(patch.materialCount)),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

async function deleteCollectionDocs(ownerId: string, colPath: string): Promise<void> {
  const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
  const snap = await getDocs(q);
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function deleteSubjectCascade(
  ownerId: string,
  subjectId: string
): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    const materialsQ = query(
      collection(db, `subjects/${subjectId}/materials`),
      where("ownerId", "==", ownerId)
    );
    const materialsSnap = await getDocs(materialsQ);
    for (const matDoc of materialsSnap.docs) {
      await deleteCollectionDocs(
        ownerId,
        `subjects/${subjectId}/materials/${matDoc.id}/chunks`
      );
      await deleteDoc(matDoc.ref);
    }

    await deleteCollectionDocs(ownerId, `subjects/${subjectId}/contentMap`);
    await deleteCollectionDocs(ownerId, `subjects/${subjectId}/questions`);
    await deleteCollectionDocs(ownerId, `subjects/${subjectId}/attempts`);
    await deleteCollectionDocs(ownerId, `subjects/${subjectId}/exams`);
    await deleteDoc(doc(db, "subjects", subjectId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeToSubjectMaterials(
  ownerId: string,
  subjectId: string,
  onData: (materials: CourseMaterial[]) => void
): () => void {
  const colPath = `subjects/${subjectId}/materials`;
  const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const list: CourseMaterial[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CourseMaterial, "id">),
      }));
      list.sort((a, b) => (a.folder || "").localeCompare(b.folder || ""));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

export async function saveExtractedMaterial(
  ownerId: string,
  subjectId: string,
  currentMaterialCount: number,
  input: {
    fileName: string;
    fileType: MaterialFileType;
    mimeType: string;
    fileSize: number;
    folder: string;
    storagePath: string;
    extractedCharCount: number;
    pageCount: number;
    ocrUsed: boolean;
    summary: string;
    chunks: { chunkIndex: number; pageRange: string; text: string }[];
  }
): Promise<string> {
  const materialId = generateDocId("mat");
  const path = `subjects/${subjectId}/materials/${materialId}`;
  try {
    await setDoc(doc(db, `subjects/${subjectId}/materials`, materialId), {
      ownerId,
      subjectId,
      fileName: input.fileName.slice(0, 255),
      fileType: input.fileType,
      mimeType: input.mimeType.slice(0, 120),
      fileSize: Math.max(0, Math.round(input.fileSize)),
      folder: (input.folder.trim() || "General").slice(0, 100),
      storagePath: input.storagePath.slice(0, 500),
      extractedCharCount: Math.max(0, Math.round(input.extractedCharCount)),
      pageCount: Math.max(0, Math.round(input.pageCount)),
      chunkCount: Math.max(1, input.chunks.length),
      ocrUsed: Boolean(input.ocrUsed),
      status: "extracted",
      summary: input.summary.slice(0, 2500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < input.chunks.length; i += 400) {
      const batch = writeBatch(db);
      input.chunks.slice(i, i + 400).forEach((chunk) => {
        const chunkId = generateDocId("chk");
        batch.set(
          doc(db, `subjects/${subjectId}/materials/${materialId}/chunks`, chunkId),
          {
            ownerId,
            subjectId,
            materialId,
            chunkIndex: Math.round(chunk.chunkIndex),
            pageRange: chunk.pageRange.slice(0, 100),
            text: chunk.text.slice(0, 250000),
            createdAt: serverTimestamp(),
          }
        );
      });
      await batch.commit();
    }

    await updateDoc(doc(db, "subjects", subjectId), {
      materialCount: Math.max(0, Math.round(currentMaterialCount + 1)),
      updatedAt: serverTimestamp(),
    });

    return materialId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function replaceMaterialFile(
  ownerId: string,
  subjectId: string,
  materialId: string,
  input: {
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
): Promise<void> {
  const path = `subjects/${subjectId}/materials/${materialId}`;
  try {
    await deleteCollectionDocs(
      ownerId,
      `subjects/${subjectId}/materials/${materialId}/chunks`
    );

    await updateDoc(doc(db, `subjects/${subjectId}/materials`, materialId), {
      fileName: input.fileName.slice(0, 255),
      fileType: input.fileType,
      mimeType: input.mimeType.slice(0, 120),
      fileSize: Math.max(0, Math.round(input.fileSize)),
      storagePath: input.storagePath.slice(0, 500),
      extractedCharCount: Math.max(0, Math.round(input.extractedCharCount)),
      pageCount: Math.max(0, Math.round(input.pageCount)),
      chunkCount: Math.max(1, input.chunks.length),
      ocrUsed: Boolean(input.ocrUsed),
      status: "extracted",
      summary: input.summary.slice(0, 2500),
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < input.chunks.length; i += 400) {
      const batch = writeBatch(db);
      input.chunks.slice(i, i + 400).forEach((chunk) => {
        const chunkId = generateDocId("chk");
        batch.set(
          doc(db, `subjects/${subjectId}/materials/${materialId}/chunks`, chunkId),
          {
            ownerId,
            subjectId,
            materialId,
            chunkIndex: Math.round(chunk.chunkIndex),
            pageRange: chunk.pageRange.slice(0, 100),
            text: chunk.text.slice(0, 250000),
            createdAt: serverTimestamp(),
          }
        );
      });
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateMaterialFolderOrName(
  subjectId: string,
  materialId: string,
  folder: string,
  fileName: string
): Promise<void> {
  const path = `subjects/${subjectId}/materials/${materialId}`;
  try {
    await updateDoc(doc(db, `subjects/${subjectId}/materials`, materialId), {
      folder: (folder.trim() || "General").slice(0, 100),
      fileName: fileName.trim().slice(0, 255),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteMaterialWithChunks(
  ownerId: string,
  subjectId: string,
  materialId: string,
  currentMaterialCount: number
): Promise<void> {
  const path = `subjects/${subjectId}/materials/${materialId}`;
  try {
    await deleteCollectionDocs(
      ownerId,
      `subjects/${subjectId}/materials/${materialId}/chunks`
    );
    await deleteDoc(doc(db, `subjects/${subjectId}/materials`, materialId));
    await updateDoc(doc(db, "subjects", subjectId), {
      materialCount: Math.max(0, Math.round(currentMaterialCount - 1)),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function fetchAllMaterialTexts(
  ownerId: string,
  subjectId: string,
  materials: CourseMaterial[]
): Promise<
  {
    fileName: string;
    folder: string;
    fileType: MaterialFileType;
    storagePath: string;
    text: string;
  }[]
> {
  const results: {
    fileName: string;
    folder: string;
    fileType: MaterialFileType;
    storagePath: string;
    text: string;
  }[] = [];
  for (const mat of materials) {
    const colPath = `subjects/${subjectId}/materials/${mat.id}/chunks`;
    try {
      const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
      const snap = await getDocs(q);
      const chunks = snap.docs
        .map((d) => d.data() as MaterialChunk)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
      const text = chunks.map((c) => c.text).join("\n");
      results.push({
        fileName: mat.fileName,
        folder: mat.folder,
        fileType: mat.fileType,
        storagePath: mat.storagePath || "",
        text: text || mat.summary || `[Material: ${mat.fileName}]`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  }
  return results;
}

export async function clearAndSaveContentMap(
  ownerId: string,
  subjectId: string,
  nodes: Omit<ContentMapNode, "id" | "ownerId" | "subjectId" | "orderIndex">[]
): Promise<void> {
  const colPath = `subjects/${subjectId}/contentMap`;
  try {
    await deleteCollectionDocs(ownerId, colPath);
    const BATCH_LIMIT = 10;
    const batches: Promise<void>[] = [];
    for (let i = 0; i < nodes.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      nodes.slice(i, i + BATCH_LIMIT).forEach((node, idx) => {
        const nodeId = generateDocId("map");
        batch.set(doc(db, colPath, nodeId), {
          ownerId,
          subjectId,
          lecture: (node.lecture || "Course Overview").slice(0, 150),
          topic: (node.topic || "Core Concepts").slice(0, 200),
          subtopics: (node.subtopics || []).slice(0, 40),
          definitions: (node.definitions || []).slice(0, 40),
          formulas: (node.formulas || []).slice(0, 40),
          examples: (node.examples || []).slice(0, 40),
          sourceFiles: (node.sourceFiles || []).slice(0, 30),
          orderIndex: i + idx,
          createdAt: serverTimestamp(),
        });
      });
      batches.push(batch.commit());
    }
    for (let i = 0; i < batches.length; i += 4) {
      await Promise.all(batches.slice(i, i + 4));
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, colPath);
  }
}

export async function clearSubjectQuestions(
  ownerId: string,
  subjectId: string
): Promise<void> {
  const colPath = `subjects/${subjectId}/questions`;
  try {
    await deleteCollectionDocs(ownerId, colPath);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, colPath);
  }
}

export async function saveQuestionsBatch(
  ownerId: string,
  subjectId: string,
  questions: Omit<QuestionItem, "id" | "ownerId" | "subjectId">[]
): Promise<number> {
  const colPath = `subjects/${subjectId}/questions`;
  try {
    const BATCH_LIMIT = 10;
    const validQuestions = questions.filter(
      (q) => q.prompt?.trim() && q.correctAnswer?.trim()
    );
    for (let i = 0; i < validQuestions.length; i += BATCH_LIMIT * 4) {
      const wavePromises: Promise<void>[] = [];
      for (
        let j = i;
        j < Math.min(i + BATCH_LIMIT * 4, validQuestions.length);
        j += BATCH_LIMIT
      ) {
        const slice = validQuestions.slice(j, j + BATCH_LIMIT);
        const batch = writeBatch(db);
        slice.forEach((q) => {
          const qId = generateDocId("q");
          const cleanOptions = (q.options || [])
            .map((o) => String(o).trim())
            .filter(Boolean)
            .slice(0, 10);
          const cleanPairs = (q.matchingPairs || [])
            .map((p) => String(p).trim())
            .filter(Boolean)
            .slice(0, 10);

          const rawFigureUrl = String(q.figureUrl || "").trim().slice(0, 500);
          const safeFigureUrl = /^\/api\/files\/[a-zA-Z0-9_%\-]+\/[a-zA-Z0-9_%\-.]+$/.test(
            rawFigureUrl
          )
            ? rawFigureUrl
            : "";
          const safeFigureCaption = String(q.figureCaption || "").trim().slice(0, 300);

          batch.set(doc(db, colPath, qId), {
            ownerId,
            subjectId,
            lecture: (q.lecture?.trim() || "General Course").slice(0, 150),
            topic: (q.topic?.trim() || "Core Concepts").slice(0, 200),
            type: q.type,
            difficulty: q.difficulty,
            source: q.source,
            sourceRef: (q.sourceRef?.trim() || "Course Material").slice(0, 300),
            prompt: q.prompt.trim().slice(0, 4000),
            options: cleanOptions,
            matchingPairs: cleanPairs,
            correctAnswer: q.correctAnswer.trim().slice(0, 4000),
            explanation: (
              q.explanation?.trim() ||
              `Correct answer: ${q.correctAnswer.trim()}`
            ).slice(0, 6000),
            ...(safeFigureUrl ? { figureUrl: safeFigureUrl } : {}),
            ...(safeFigureUrl && safeFigureCaption
              ? { figureCaption: safeFigureCaption }
              : {}),
            createdAt: serverTimestamp(),
          });
        });
        wavePromises.push(batch.commit());
      }
      await Promise.all(wavePromises);
    }
    return validQuestions.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, colPath);
  }
}

export async function syncSubjectQuestionCount(
  subjectId: string,
  actualCount: number
): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    await updateDoc(doc(db, "subjects", subjectId), {
      questionCount: Math.max(0, Math.round(actualCount)),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeToContentMap(
  ownerId: string,
  subjectId: string,
  onData: (nodes: ContentMapNode[]) => void
): () => void {
  const colPath = `subjects/${subjectId}/contentMap`;
  const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ContentMapNode, "id">),
        }))
        .sort((a, b) => a.orderIndex - b.orderIndex);
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

export function subscribeToQuestions(
  ownerId: string,
  subjectId: string,
  onData: (questions: QuestionItem[]) => void
): () => void {
  const colPath = `subjects/${subjectId}/questions`;
  const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const sourceOrder: Record<string, number> = {
        Professor: 0,
        Lecture: 1,
        "AI Generated": 2,
      };
      const list = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<QuestionItem, "id">),
        }))
        .sort((a, b) => {
          const sDiff = (sourceOrder[a.source] ?? 3) - (sourceOrder[b.source] ?? 3);
          if (sDiff !== 0) return sDiff;
          return a.lecture.localeCompare(b.lecture);
        });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

export function subscribeToAttempts(
  ownerId: string,
  subjectId: string,
  onData: (attempts: QuestionAttempt[]) => void
): () => void {
  const colPath = `subjects/${subjectId}/attempts`;
  const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<QuestionAttempt, "id">),
      }));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

export async function recordQuestionAttempt(
  ownerId: string,
  subjectId: string,
  question: QuestionItem,
  userAnswer: string,
  isCorrect: boolean,
  allAttempts: QuestionAttempt[]
): Promise<void> {
  const attemptRef = doc(db, `subjects/${subjectId}/attempts`, question.id);
  const path = `subjects/${subjectId}/attempts/${question.id}`;
  try {
    const existing = allAttempts.find((a) => a.questionId === question.id);
    if (!existing) {
      await setDoc(attemptRef, {
        ownerId,
        subjectId,
        questionId: question.id,
        lecture: (question.lecture || "General").slice(0, 150),
        topic: (question.topic || "Core Concepts").slice(0, 200),
        questionType: question.type,
        userAnswer: userAnswer.slice(0, 4000),
        isCorrect,
        attemptsCount: 1,
        incorrectCount: isCorrect ? 0 : 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(attemptRef, {
        userAnswer: userAnswer.slice(0, 4000),
        isCorrect,
        attemptsCount: existing.attemptsCount + 1,
        incorrectCount: existing.incorrectCount + (isCorrect ? 0 : 1),
        updatedAt: serverTimestamp(),
      });
    }

    const updatedMap = new Map<string, boolean>();
    for (const a of allAttempts) {
      updatedMap.set(a.questionId, a.isCorrect);
    }
    updatedMap.set(question.id, isCorrect);
    const answeredCount = updatedMap.size;
    const correctCount = [...updatedMap.values()].filter(Boolean).length;

    await updateDoc(doc(db, "subjects", subjectId), {
      answeredCount,
      correctCount,
      lastStudiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function batchRecordQuestionAttempts(
  ownerId: string,
  subjectId: string,
  entries: { question: QuestionItem; userAnswer: string; isCorrect: boolean }[],
  existingAttempts: QuestionAttempt[]
): Promise<void> {
  const colPath = `subjects/${subjectId}/attempts`;
  try {
    const existingMap = new Map<string, QuestionAttempt>();
    for (const a of existingAttempts) existingMap.set(a.questionId, a);

    const BATCH_LIMIT = 10;
    for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      entries.slice(i, i + BATCH_LIMIT).forEach(({ question, userAnswer, isCorrect }) => {
        const ref = doc(db, colPath, question.id);
        const existing = existingMap.get(question.id);
        if (!existing) {
          batch.set(ref, {
            ownerId,
            subjectId,
            questionId: question.id,
            lecture: (question.lecture || "General").slice(0, 150),
            topic: (question.topic || "Core Concepts").slice(0, 200),
            questionType: question.type,
            userAnswer: userAnswer.slice(0, 4000),
            isCorrect,
            attemptsCount: 1,
            incorrectCount: isCorrect ? 0 : 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(ref, {
            userAnswer: userAnswer.slice(0, 4000),
            isCorrect,
            attemptsCount: existing.attemptsCount + 1,
            incorrectCount: existing.incorrectCount + (isCorrect ? 0 : 1),
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    }

    const updatedMap = new Map<string, boolean>();
    for (const a of existingAttempts) updatedMap.set(a.questionId, a.isCorrect);
    for (const e of entries) updatedMap.set(e.question.id, e.isCorrect);

    await updateDoc(doc(db, "subjects", subjectId), {
      answeredCount: updatedMap.size,
      correctCount: [...updatedMap.values()].filter(Boolean).length,
      lastStudiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, colPath);
  }
}

export function subscribeToExams(
  ownerId: string,
  subjectId: string,
  onData: (exams: ExamSimulation[]) => void
): () => void {
  const colPath = `subjects/${subjectId}/exams`;
  const q = query(collection(db, colPath), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ExamSimulation, "id">),
        }))
        .sort((a, b) => (b.startedAt?.seconds || 0) - (a.startedAt?.seconds || 0));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, colPath);
    }
  );
}

export async function createExamSession(
  ownerId: string,
  subjectId: string,
  input: {
    title: string;
    questionIds: string[];
    durationMinutes: number;
  }
): Promise<string> {
  const examId = generateDocId("ex");
  const path = `subjects/${subjectId}/exams/${examId}`;
  try {
    await setDoc(doc(db, `subjects/${subjectId}/exams`, examId), {
      ownerId,
      subjectId,
      title: input.title.slice(0, 150),
      questionIds: input.questionIds.slice(0, 200),
      answers: {},
      durationMinutes: Math.max(1, Math.min(300, Math.round(input.durationMinutes))),
      score: 0,
      correctCount: 0,
      totalQuestions: input.questionIds.length,
      status: "in_progress",
      startedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return examId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function saveExamAnswersDraft(
  subjectId: string,
  examId: string,
  answers: Record<string, string>
): Promise<void> {
  const path = `subjects/${subjectId}/exams/${examId}`;
  try {
    await updateDoc(doc(db, `subjects/${subjectId}/exams`, examId), {
      answers,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function submitExamSession(
  subjectId: string,
  examId: string,
  answers: Record<string, string>,
  correctCount: number,
  totalQuestions: number
): Promise<void> {
  const path = `subjects/${subjectId}/exams/${examId}`;
  const score =
    totalQuestions > 0
      ? Math.round((correctCount / totalQuestions) * 1000) / 10
      : 0;
  try {
    await updateDoc(doc(db, `subjects/${subjectId}/exams`, examId), {
      answers,
      correctCount: Math.round(correctCount),
      score,
      status: "submitted",
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
