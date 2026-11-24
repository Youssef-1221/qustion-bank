import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileCheck2,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { evaluateAnswerWithAi } from "../lib/apiClient";
import {
  batchRecordQuestionAttempts,
  createExamSession,
  saveExamAnswersDraft,
  submitExamSession,
} from "../lib/firestoreService";
import {
  DifficultyLevel,
  ExamSimulation,
  QUESTION_TYPE_LABELS,
  QuestionAttempt,
  QuestionItem,
  QuestionType,
} from "../types/course";
import { ProtectedFigure } from "./ProtectedFigure";

interface ExamSimulationPanelProps {
  ownerId: string;
  subjectId: string;
  subjectName: string;
  questions: QuestionItem[];
  attempts: QuestionAttempt[];
  exams: ExamSimulation[];
}

export function ExamSimulationPanel({
  ownerId,
  subjectId,
  subjectName,
  questions,
  attempts,
  exams,
}: ExamSimulationPanelProps) {
  const [title, setTitle] = useState(`${subjectName} Mock Exam`);
  const [questionCount, setQuestionCount] = useState(25);
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [difficulty, setDifficulty] = useState<DifficultyLevel | "ALL">("ALL");
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    "mcq",
    "true_false",
    "complete",
    "short_answer",
    "numerical",
    "matching",
    "essay",
  ]);
  const [selectedLectures, setSelectedLectures] = useState<string[]>([]);

  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [activeQIndex, setActiveQIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [reviewExamId, setReviewExamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const answersRef = useRef<Record<string, string>>({});

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const lectures = useMemo(
    () => Array.from(new Set(questions.map((q) => q.lecture))).sort(),
    [questions]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of questions) {
      counts[q.type] = (counts[q.type] || 0) + 1;
    }
    return counts;
  }, [questions]);

  const questionMap = useMemo(() => {
    const map = new Map<string, QuestionItem>();
    for (const q of questions) map.set(q.id, q);
    return map;
  }, [questions]);

  const activeExam = useMemo(
    () => exams.find((e) => e.id === activeExamId) || null,
    [exams, activeExamId]
  );

  const reviewExam = useMemo(
    () => exams.find((e) => e.id === reviewExamId) || null,
    [exams, reviewExamId]
  );

  const eligibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (!selectedTypes.includes(q.type)) return false;
      if (difficulty !== "ALL" && q.difficulty !== difficulty) return false;
      if (selectedLectures.length > 0 && !selectedLectures.includes(q.lecture)) {
        return false;
      }
      return true;
    });
  }, [questions, selectedTypes, difficulty, selectedLectures]);

  const handleToggleType = (t: QuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleToggleLecture = (l: string) => {
    setSelectedLectures((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );
  };

  const safeSaveDraft = (examId: string, nextAnswers: Record<string, string>) => {
    if (submittingRef.current) return;
    void saveExamAnswersDraft(subjectId, examId, nextAnswers).catch(() => {
      // Ignore draft sync errors if exam is already submitting/submitted
    });
  };

  const handleStartExam = async () => {
    if (eligibleQuestions.length === 0) {
      setError("No questions match your exam filters. Analyze course materials first.");
      return;
    }
    setError(null);
    const shuffled = [...eligibleQuestions].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, Math.min(questionCount, shuffled.length));
    const qIds = chosen.map((q) => q.id);

    try {
      const newId = await createExamSession(ownerId, subjectId, {
        title: title.trim() || `${subjectName} Exam`,
        questionIds: qIds,
        durationMinutes,
      });
      setAnswers({});
      answersRef.current = {};
      setActiveQIndex(0);
      setSecondsLeft(durationMinutes * 60);
      setReviewExamId(null);
      setActiveExamId(newId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start exam simulation.");
    }
  };

  const handleSubmitExam = async () => {
    if (!activeExam || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const finalAnswers = { ...answersRef.current };
      const examQuestions = activeExam.questionIds
        .map((id) => questionMap.get(id))
        .filter((q): q is QuestionItem => Boolean(q));

      const gradedEntries: {
        question: QuestionItem;
        userAnswer: string;
        isCorrect: boolean;
      }[] = new Array(examQuestions.length);

      // Grade objective questions immediately, and queue free-form questions in parallel batches of 5
      const aiQueue: { idx: number; q: QuestionItem; ans: string }[] = [];

      examQuestions.forEach((q, idx) => {
        const userAns = (finalAnswers[q.id] || "").trim();
        if (!userAns) {
          gradedEntries[idx] = { question: q, userAnswer: "", isCorrect: false };
          return;
        }
        if (q.type === "mcq" || q.type === "true_false") {
          const isCorrect =
            userAns.toLowerCase() === q.correctAnswer.trim().toLowerCase();
          gradedEntries[idx] = { question: q, userAnswer: userAns, isCorrect };
        } else if (q.type === "matching") {
          const expected = q.matchingPairs
            .map((p) => {
              const [l, r] = p.split("||").map((s) => s.trim());
              return `${l} -> ${r}`;
            })
            .join("; ");
          const isCorrect = userAns.toLowerCase() === expected.toLowerCase();
          gradedEntries[idx] = { question: q, userAnswer: userAns, isCorrect };
        } else {
          aiQueue.push({ idx, q, ans: userAns });
        }
      });

      for (let i = 0; i < aiQueue.length; i += 5) {
        const chunk = aiQueue.slice(i, i + 5);
        await Promise.all(
          chunk.map(async ({ idx, q, ans }) => {
            try {
              const res = await evaluateAnswerWithAi({
                questionPrompt: q.prompt,
                questionType: q.type,
                correctAnswer: q.correctAnswer,
                explanation: q.explanation,
                userAnswer: ans,
              });
              gradedEntries[idx] = {
                question: q,
                userAnswer: ans,
                isCorrect: res.isCorrect,
              };
            } catch {
              const fallbackMatch =
                ans.toLowerCase() === q.correctAnswer.trim().toLowerCase();
              gradedEntries[idx] = {
                question: q,
                userAnswer: ans,
                isCorrect: fallbackMatch,
              };
            }
          })
        );
      }

      const validEntries = gradedEntries.filter(Boolean);
      const correctCount = validEntries.filter((e) => e.isCorrect).length;

      await batchRecordQuestionAttempts(ownerId, subjectId, validEntries, attempts);
      await submitExamSession(
        subjectId,
        activeExam.id,
        finalAnswers,
        correctCount,
        examQuestions.length
      );
      setReviewExamId(activeExam.id);
      setActiveExamId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit exam.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!activeExam || activeExam.status !== "in_progress") return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExamId]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  // Active Exam Screen (Answers Hidden!)
  if (activeExam && activeExam.status === "in_progress") {
    const examQuestions = activeExam.questionIds
      .map((id) => questionMap.get(id))
      .filter((q): q is QuestionItem => Boolean(q));
    const currentQ = examQuestions[activeQIndex];
    const answeredCount = examQuestions.filter((q) =>
      Boolean((answers[q.id] || "").trim())
    ).length;

    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {activeExam.title}
            </h2>
            <p className="text-xs text-slate-500 tabular-nums">
              {answeredCount} of {examQuestions.length} answered · Answers hidden until submission
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg font-mono text-sm font-semibold text-slate-900 tabular-nums">
              <Clock className="w-4 h-4 text-sky-700" />
              <span>{formatTimer(secondsLeft)}</span>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmitExam()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileCheck2 className="w-4 h-4" />
              )}
              <span>{submitting ? "Grading Exam..." : "Submit Exam"}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            {currentQ ? (
              <>
                <div className="flex items-center justify-between text-xs text-slate-500 pb-3 border-b border-slate-100">
                  <span className="font-mono font-semibold text-slate-800 tabular-nums">
                    Question {activeQIndex + 1} / {examQuestions.length}
                  </span>
                  <span>
                    {QUESTION_TYPE_LABELS[currentQ.type]} · {currentQ.difficulty}
                  </span>
                </div>

                <p className="text-base font-medium text-slate-900 leading-relaxed whitespace-pre-wrap">
                  {currentQ.prompt}
                </p>

                {currentQ.figureUrl && (
                  <ProtectedFigure
                    src={currentQ.figureUrl}
                    caption={currentQ.figureCaption}
                  />
                )}

                {currentQ.type === "mcq" && (
                  <div className="space-y-2.5">
                    {currentQ.options.map((opt, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      const selected = answers[currentQ.id] === opt;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            const next = { ...answers, [currentQ.id]: opt };
                            setAnswers(next);
                            safeSaveDraft(activeExam.id, next);
                          }}
                          className={`w-full text-left px-4 py-3 text-sm rounded-lg border transition-colors flex items-start gap-3 ${
                            selected
                              ? "border-sky-600 bg-sky-50 text-slate-900 font-medium"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          <span className="font-mono font-semibold text-slate-500 shrink-0">
                            {letter}.
                          </span>
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQ.type === "true_false" && (
                  <div className="flex items-center gap-3">
                    {["True", "False"].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          const next = { ...answers, [currentQ.id]: val };
                          setAnswers(next);
                          safeSaveDraft(activeExam.id, next);
                        }}
                        className={`px-6 py-2.5 text-sm font-medium rounded-lg border ${
                          answers[currentQ.id] === val
                            ? "border-sky-600 bg-sky-50 text-sky-900"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                )}

                {currentQ.type === "matching" && (
                  <div className="space-y-3">
                    {currentQ.matchingPairs.map((pair, idx) => {
                      const left = pair.split("||")[0]?.trim() || "";
                      const rightChoices = currentQ.matchingPairs
                        .map((p) => p.split("||")[1]?.trim() || "")
                        .filter(Boolean)
                        .sort((a, b) => a.localeCompare(b));
                      const currentParts = (answers[currentQ.id] || "").split("; ");
                      const selectedForIdx =
                        currentParts[idx]?.split(" -> ")[1]?.trim() || "";

                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                        >
                          <span className="text-sm font-medium text-slate-900">
                            {left}
                          </span>
                          <select
                            value={selectedForIdx === "(none)" ? "" : selectedForIdx}
                            onChange={(e) => {
                              const updated = currentQ.matchingPairs.map((p, pIdx) => {
                                const term = p.split("||")[0]?.trim() || "";
                                const prevSel =
                                  currentParts[pIdx]?.split(" -> ")[1]?.trim() || "(none)";
                                const val = pIdx === idx ? e.target.value || "(none)" : prevSel;
                                return `${term} -> ${val}`;
                              });
                              const next = {
                                ...answers,
                                [currentQ.id]: updated.join("; "),
                              };
                              setAnswers(next);
                              safeSaveDraft(activeExam.id, next);
                            }}
                            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                          >
                            <option value="">Select matching definition...</option>
                            {rightChoices.map((opt, rIdx) => (
                              <option key={rIdx} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}

                {currentQ.type !== "mcq" &&
                  currentQ.type !== "true_false" &&
                  currentQ.type !== "matching" && (
                    <div>
                      <textarea
                        rows={currentQ.type === "essay" ? 6 : 3}
                        value={answers[currentQ.id] || ""}
                        onChange={(e) => {
                          const next = { ...answers, [currentQ.id]: e.target.value };
                          setAnswers(next);
                        }}
                        onBlur={() => safeSaveDraft(activeExam.id, answers)}
                        placeholder="Write your answer..."
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  )}

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={activeQIndex <= 0}
                    onClick={() => setActiveQIndex((i) => Math.max(0, i - 1))}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={activeQIndex >= examQuestions.length - 1}
                    onClick={() =>
                      setActiveQIndex((i) => Math.min(examQuestions.length - 1, i + 1))
                    }
                    className="px-3.5 py-2 text-xs font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-40"
                  >
                    Next Question
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Loading exam questions...
              </p>
            )}
          </div>

          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 h-fit">
            <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
              Question Navigator
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {examQuestions.map((q, idx) => {
                const hasAns = Boolean((answers[q.id] || "").trim());
                const isCurrent = idx === activeQIndex;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setActiveQIndex(idx)}
                    className={`py-2 text-xs font-mono font-medium rounded-md border tabular-nums transition-colors ${
                      isCurrent
                        ? "border-sky-600 bg-sky-600 text-white"
                        : hasAns
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Review Submitted Exam Screen
  if (reviewExam && reviewExam.status === "submitted") {
    const examQuestions = reviewExam.questionIds
      .map((id) => questionMap.get(id))
      .filter((q): q is QuestionItem => Boolean(q));

    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-sky-700">Exam Completed</p>
            <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
              {reviewExam.title}
            </h2>
            <p className="text-sm text-slate-600 mt-1 tabular-nums">
              Score:{" "}
              <span className="font-mono font-semibold text-slate-900">
                {reviewExam.score}%
              </span>{" "}
              · {reviewExam.correctCount} of {reviewExam.totalQuestions} correct
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReviewExamId(null)}
            className="px-4 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Back to Exam Setup
          </button>
        </div>

        <div className="space-y-4">
          {examQuestions.map((q, idx) => {
            const studentAns = reviewExam.answers?.[q.id] || "";
            const att = attempts.find((a) => a.questionId === q.id);
            const isCorrect = att
              ? att.isCorrect
              : studentAns.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();

            return (
              <div
                key={q.id}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-slate-700 tabular-nums">
                    Q{idx + 1} · {QUESTION_TYPE_LABELS[q.type]} · {q.lecture}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      isCorrect ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {isCorrect ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Correct</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4" />
                        <span>Incorrect</span>
                      </>
                    )}
                  </span>
                </div>

                <p className="text-base font-medium text-slate-900 leading-relaxed whitespace-pre-wrap">
                  {q.prompt}
                </p>

                {q.figureUrl && (
                  <ProtectedFigure src={q.figureUrl} caption={q.figureCaption} />
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 block mb-1.5">
                      Your Answer
                    </span>
                    <span className="text-base font-medium text-slate-900 whitespace-pre-wrap">
                      {studentAns || "(No answer provided)"}
                    </span>
                  </div>
                  <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-xl">
                    <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800 block mb-1.5">
                      Correct Answer
                    </span>
                    <span className="text-base sm:text-lg font-semibold text-emerald-950 whitespace-pre-wrap">
                      {q.correctAnswer}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 block mb-1.5">
                    Step-by-Step Solution
                  </span>
                  <div className="text-[15px] text-slate-800 leading-7 whitespace-pre-wrap">
                    {q.explanation}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Exam Builder Configurator + Past Exams
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Configure Exam Simulation
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Answers and explanations remain hidden until you submit the exam or time expires.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Exam Title
            </label>
            <input
              type="text"
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Questions
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={questionCount}
              onChange={(e) =>
                setQuestionCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Duration (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={300}
              value={durationMinutes}
              onChange={(e) =>
                setDurationMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 1)))
              }
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Difficulty
            </label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as DifficultyLevel | "ALL")}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="ALL">All Levels</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-2">
            Include Question Types
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => {
              const active = selectedTypes.includes(t);
              const count = typeCounts[t] || 0;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleToggleType(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors tabular-nums ${
                    active
                      ? "border-sky-600 bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {QUESTION_TYPE_LABELS[t]} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {lectures.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-2">
              Selected Lectures{" "}
              <span className="text-slate-400">(leave empty for full course)</span>
            </label>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {lectures.map((l) => {
                const active = selectedLectures.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => handleToggleLecture(l)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-600 tabular-nums">
            Eligible pool: <strong className="font-mono">{eligibleQuestions.length}</strong>{" "}
            questions
          </span>
          <button
            type="button"
            disabled={eligibleQuestions.length === 0}
            onClick={() => void handleStartExam()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            <span>Start Exam Simulation</span>
          </button>
        </div>
      </div>

      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit">
        <h3 className="font-display text-base font-semibold text-slate-900">
          Past Exam Simulations
        </h3>
        {exams.length === 0 ? (
          <p className="text-sm text-slate-500">
            No exam simulations completed yet. Configure and start an exam on the left.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {exams.map((ex) => (
              <div
                key={ex.id}
                className="py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {ex.title}
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {ex.status === "submitted"
                      ? `${ex.score}% (${ex.correctCount}/${ex.totalQuestions} correct)`
                      : `In progress · ${ex.totalQuestions} questions`}
                  </p>
                </div>
                {ex.status === "submitted" ? (
                  <button
                    type="button"
                    onClick={() => setReviewExamId(ex.id)}
                    className="text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                  >
                    Review →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAnswers(ex.answers || {});
                      answersRef.current = ex.answers || {};
                      setSecondsLeft(ex.durationMinutes * 60);
                      setActiveQIndex(0);
                      setActiveExamId(ex.id);
                    }}
                    className="text-xs font-medium text-amber-700 hover:text-amber-800 whitespace-nowrap"
                  >
                    Resume →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
