import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  XCircle,
} from "lucide-react";
import { evaluateAnswerWithAi } from "../lib/apiClient";
import { recordQuestionAttempt } from "../lib/firestoreService";
import {
  QUESTION_TYPE_LABELS,
  QuestionAttempt,
  QuestionItem,
} from "../types/course";
import { ProtectedFigure } from "./ProtectedFigure";

interface PracticeModePanelProps {
  ownerId: string;
  subjectId: string;
  questions: QuestionItem[];
  attempts: QuestionAttempt[];
  sessionLabel: string;
  onChangeMode: (mode: "all" | "professor" | "ai" | "weak") => void;
  activeMode: "all" | "professor" | "ai" | "weak" | "custom";
}

export function PracticeModePanel({
  ownerId,
  subjectId,
  questions,
  attempts,
  sessionLabel,
  onChangeMode,
  activeMode,
}: PracticeModePanelProps) {
  const [index, setIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [matchingSelections, setMatchingSelections] = useState<Record<number, string>>({});
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{
    isCorrect: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeIndex = questions.length > 0 ? Math.min(index, questions.length - 1) : 0;
  const current = questions[safeIndex];

  const matchingRightOptions = useMemo(() => {
    if (!current || current.type !== "matching") return [];
    const rights = current.matchingPairs
      .map((p) => p.split("||")[1]?.trim() || "")
      .filter(Boolean);
    // Deterministic shuffle based on prompt length + index
    return [...rights].sort((a, b) => a.localeCompare(b));
  }, [current]);

  const goTo = (nextIdx: number) => {
    setIndex(nextIdx);
    setUserAnswer("");
    setMatchingSelections({});
    setFeedback(null);
    setError(null);
  };

  const handleCheckAnswer = async () => {
    if (!current) return;
    setChecking(true);
    setError(null);

    try {
      let submitted = userAnswer.trim();
      let isCorrect = false;
      let feedbackMsg = "";

      if (current.type === "matching") {
        const pairs = current.matchingPairs.map((p) => {
          const [l, r] = p.split("||").map((s) => s.trim());
          return { l, r };
        });
        const userPairs = pairs.map((p, i) => `${p.l} -> ${matchingSelections[i] || "(none)"}`);
        submitted = userPairs.join("; ");
        const allCorrect = pairs.every(
          (p, i) =>
            (matchingSelections[i] || "").trim().toLowerCase() === p.r.toLowerCase()
        );
        isCorrect = allCorrect;
        feedbackMsg = allCorrect
          ? "All matching pairs are correct."
          : "One or more pairs do not match. Review the correct pairings below.";
      } else if (current.type === "mcq" || current.type === "true_false") {
        isCorrect =
          submitted.toLowerCase() === current.correctAnswer.trim().toLowerCase();
        feedbackMsg = isCorrect
          ? "Correct answer."
          : `Incorrect. Correct answer: ${current.correctAnswer}`;
      } else {
        const evalRes = await evaluateAnswerWithAi({
          questionPrompt: current.prompt,
          questionType: current.type,
          correctAnswer: current.correctAnswer,
          explanation: current.explanation,
          userAnswer: submitted,
        });
        isCorrect = evalRes.isCorrect;
        feedbackMsg = evalRes.feedback;
      }

      setFeedback({ isCorrect, message: feedbackMsg });
      await recordQuestionAttempt(
        ownerId,
        subjectId,
        current,
        submitted,
        isCorrect,
        attempts
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check answer.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Mode Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              ["all", "All Questions"],
              ["professor", "Professor Only"],
              ["ai", "AI Generated"],
              ["weak", "Weak Areas"],
            ] as const
          ).map(([modeKey, label]) => (
            <button
              key={modeKey}
              type="button"
              onClick={() => {
                onChangeMode(modeKey);
                goTo(0);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeMode === modeKey
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="text-xs font-medium text-slate-600 tabular-nums">
          {sessionLabel} ·{" "}
          {questions.length > 0 ? `${safeIndex + 1} / ${questions.length}` : "0 questions"}
        </span>
      </div>

      {!current ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <h3 className="font-display text-base font-semibold text-slate-900">
            No Questions in This Practice Set
          </h3>
          <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
            {activeMode === "weak"
              ? "You have no weak areas recorded yet. Practice questions from All Questions or take an Exam Simulation first."
              : "Analyze your course materials to populate questions for Practice Mode."}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8 space-y-6 max-w-4xl">
          {/* Metadata Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pb-4 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold text-slate-800 tabular-nums">
                Question {safeIndex + 1}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-sky-700">{current.source}</span>
              <span aria-hidden="true">·</span>
              <span>{QUESTION_TYPE_LABELS[current.type]}</span>
              <span aria-hidden="true">·</span>
              <span>{current.difficulty}</span>
            </div>
            <span>
              {current.lecture} · {current.topic}
            </span>
          </div>

          {/* Question Prompt */}
          <div className="text-base font-medium text-slate-900 leading-relaxed whitespace-pre-wrap">
            {current.prompt}
          </div>

          {current.figureUrl && (
            <ProtectedFigure src={current.figureUrl} caption={current.figureCaption} />
          )}

          {/* Answer Input by Question Type */}
          {current.type === "mcq" && (
            <div className="space-y-2.5">
              {current.options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const selected = userAnswer === opt;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={Boolean(feedback)}
                    onClick={() => setUserAnswer(opt)}
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

          {current.type === "true_false" && (
            <div className="flex items-center gap-3">
              {["True", "False"].map((val) => (
                <button
                  key={val}
                  type="button"
                  disabled={Boolean(feedback)}
                  onClick={() => setUserAnswer(val)}
                  className={`px-6 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                    userAnswer === val
                      ? "border-sky-600 bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          )}

          {current.type === "matching" && (
            <div className="space-y-3">
              {current.matchingPairs.map((pair, idx) => {
                const left = pair.split("||")[0]?.trim() || "";
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <span className="text-sm font-medium text-slate-900">{left}</span>
                    <select
                      disabled={Boolean(feedback)}
                      value={matchingSelections[idx] || ""}
                      onChange={(e) =>
                        setMatchingSelections((prev) => ({
                          ...prev,
                          [idx]: e.target.value,
                        }))
                      }
                      className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="">Select matching definition...</option>
                      {matchingRightOptions.map((opt, rIdx) => (
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

          {(current.type === "complete" ||
            current.type === "short_answer" ||
            current.type === "essay" ||
            current.type === "numerical") && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                {current.type === "numerical"
                  ? "Enter your calculation result (include units):"
                  : current.type === "complete"
                    ? "Complete the missing term / equation:"
                    : "Your Answer:"}
              </label>
              <textarea
                rows={current.type === "essay" ? 6 : current.type === "short_answer" ? 4 : 2}
                disabled={Boolean(feedback)}
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="Type your response here..."
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          {/* Immediate Feedback & Solution */}
          {feedback && (
            <div
              className={`p-5 sm:p-6 rounded-xl border space-y-4 ${
                feedback.isCorrect
                  ? "bg-emerald-50/70 border-emerald-200"
                  : "bg-red-50/70 border-red-200"
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-base">
                {feedback.isCorrect ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                    <span className="text-emerald-900">Correct Answer</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5 text-red-700 shrink-0" />
                    <span className="text-red-900">Needs Review</span>
                  </>
                )}
              </div>
              <p className="text-sm text-slate-800">{feedback.message}</p>

              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 mb-1">
                    Reference Answer
                  </p>
                  <p className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed whitespace-pre-wrap">
                    {current.correctAnswer}
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                    Step-by-Step Explanation
                  </p>
                  <div className="text-[15px] text-slate-800 leading-7 whitespace-pre-wrap">
                    {current.explanation}
                  </div>
                </div>
                <p className="font-mono text-xs text-slate-500 pt-1">
                  Citation: {current.sourceRef}
                </p>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeIndex <= 0}
                onClick={() => goTo(safeIndex - 1)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
              <button
                type="button"
                disabled={safeIndex >= questions.length - 1}
                onClick={() => goTo(safeIndex + 1)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {!feedback ? (
              <button
                type="button"
                disabled={
                  checking ||
                  (current.type === "matching"
                    ? Object.keys(matchingSelections).length === 0
                    : !userAnswer.trim())
                }
                onClick={() => void handleCheckAnswer()}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                {checking && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{checking ? "Checking..." : "Check Answer"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  safeIndex < questions.length - 1 ? goTo(safeIndex + 1) : goTo(0)
                }
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <span>
                  {safeIndex < questions.length - 1 ? "Next Question" : "Restart Set"}
                </span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
