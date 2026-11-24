import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Play,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  DifficultyLevel,
  QUESTION_TYPE_LABELS,
  QuestionAttempt,
  QuestionItem,
  QuestionSource,
  QuestionType,
} from "../types/course";
import { ProtectedFigure } from "./ProtectedFigure";

export type BankPreset = "all" | "professor" | "ai" | "weak" | "diagrams";

interface QuestionBankPanelProps {
  questions: QuestionItem[];
  attempts: QuestionAttempt[];
  initialPreset?: BankPreset;
  onStartPractice: (filteredQuestions: QuestionItem[], label: string) => void;
}

const PAGE_SIZE = 25;

export function QuestionBankPanel({
  questions,
  attempts,
  initialPreset = "all",
  onStartPractice,
}: QuestionBankPanelProps) {
  const [preset, setPreset] = useState<BankPreset>(initialPreset);
  const [keyword, setKeyword] = useState("");
  const [lectureFilter, setLectureFilter] = useState("ALL");
  const [topicFilter, setTopicFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<QuestionType | "ALL">("ALL");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyLevel | "ALL">("ALL");
  const [sourceFilter, setSourceFilter] = useState<QuestionSource | "ALL">("ALL");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);

  const attemptMap = useMemo(() => {
    const map = new Map<string, QuestionAttempt>();
    for (const a of attempts) map.set(a.questionId, a);
    return map;
  }, [attempts]);

  const weakTopicSet = useMemo(() => {
    const topicStats = new Map<string, { wrong: number; total: number }>();
    for (const a of attempts) {
      const cur = topicStats.get(a.topic) || { wrong: 0, total: 0 };
      cur.total += 1;
      if (!a.isCorrect) cur.wrong += 1;
      topicStats.set(a.topic, cur);
    }
    const weak = new Set<string>();
    for (const [topic, s] of topicStats.entries()) {
      if (s.wrong > 0 && s.wrong / s.total >= 0.4) weak.add(topic);
    }
    return weak;
  }, [attempts]);

  const lectures = useMemo(
    () => Array.from(new Set(questions.map((q) => q.lecture))).sort(),
    [questions]
  );

  const topics = useMemo(() => {
    const base =
      lectureFilter === "ALL"
        ? questions
        : questions.filter((q) => q.lecture === lectureFilter);
    return Array.from(new Set(base.map((q) => q.topic))).sort();
  }, [questions, lectureFilter]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return questions.filter((q) => {
      if (preset === "professor" && q.source !== "Professor") return false;
      if (preset === "ai" && q.source !== "AI Generated") return false;
      if (preset === "diagrams" && !q.figureUrl) return false;
      if (preset === "weak") {
        const att = attemptMap.get(q.id);
        const isIncorrect = att ? !att.isCorrect : false;
        const isWeakTopic = weakTopicSet.has(q.topic);
        if (!isIncorrect && !isWeakTopic) return false;
      }

      if (lectureFilter !== "ALL" && q.lecture !== lectureFilter) return false;
      if (topicFilter !== "ALL" && q.topic !== topicFilter) return false;
      if (typeFilter !== "ALL" && q.type !== typeFilter) return false;
      if (difficultyFilter !== "ALL" && q.difficulty !== difficultyFilter) return false;
      if (sourceFilter !== "ALL" && q.source !== sourceFilter) return false;

      if (kw) {
        const haystack =
          `${q.prompt} ${q.topic} ${q.lecture} ${q.explanation} ${q.sourceRef}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [
    questions,
    preset,
    lectureFilter,
    topicFilter,
    typeFilter,
    difficultyFilter,
    sourceFilter,
    keyword,
    attemptMap,
    weakTopicSet,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetFilters = () => {
    setKeyword("");
    setLectureFilter("ALL");
    setTopicFilter("ALL");
    setTypeFilter("ALL");
    setDifficultyFilter("ALL");
    setSourceFilter("ALL");
    setPage(1);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allPageExpanded =
    pageItems.length > 0 && pageItems.every((q) => Boolean(expandedIds[q.id]));

  const toggleExpandAllOnPage = () => {
    setExpandedIds((prev) => {
      const next = { ...prev };
      const targetVal = !allPageExpanded;
      for (const q of pageItems) {
        next[q.id] = targetVal;
      }
      return next;
    });
  };

  const profCount = questions.filter((q) => q.source === "Professor").length;
  const aiCount = questions.filter((q) => q.source === "AI Generated").length;
  const diagramCount = questions.filter((q) => Boolean(q.figureUrl)).length;
  const weakCount = questions.filter((q) => {
    const att = attemptMap.get(q.id);
    return (att && !att.isCorrect) || weakTopicSet.has(q.topic);
  }).length;

  return (
    <div className="space-y-6">
      {/* Mode Preset Bar + Practice Trigger */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setPreset("all");
              setSourceFilter("ALL");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              preset === "all"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Full Question Bank ({questions.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setPreset("professor");
              setSourceFilter("ALL");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              preset === "professor"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Professor Only ({profCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setPreset("ai");
              setSourceFilter("ALL");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              preset === "ai"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            AI Generated ({aiCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setPreset("diagrams");
              setSourceFilter("ALL");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              preset === "diagrams"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            With Diagrams ({diagramCount})
          </button>
          <button
            type="button"
            onClick={() => {
              setPreset("weak");
              setSourceFilter("ALL");
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              preset === "weak"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Weak Areas ({weakCount})
          </button>
        </div>

        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() =>
            onStartPractice(
              filtered,
              preset === "professor"
                ? "Professor Questions"
                : preset === "ai"
                  ? "AI Generated Questions"
                  : preset === "diagrams"
                    ? "Diagram Questions"
                    : preset === "weak"
                      ? "Weak Areas Practice"
                      : "Filtered Question Bank"
            )
          }
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Practice These {filtered.length} Questions</span>
        </button>
      </div>

      {/* Smart Search & Multi-Faceted Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              placeholder="Search keywords, formulas, citations..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <select
            value={lectureFilter}
            onChange={(e) => {
              setLectureFilter(e.target.value);
              setTopicFilter("ALL");
              setPage(1);
            }}
            aria-label="Filter by Lecture"
            className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="ALL">All Lectures</option>
            {lectures.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <select
            value={topicFilter}
            onChange={(e) => {
              setTopicFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by Topic"
            className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="ALL">All Topics</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as QuestionType | "ALL");
              setPage(1);
            }}
            aria-label="Filter by Question Type"
            className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="ALL">All 7 Types</option>
            {Object.entries(QUESTION_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              value={difficultyFilter}
              onChange={(e) => {
                setDifficultyFilter(e.target.value as DifficultyLevel | "ALL");
                setPage(1);
              }}
              aria-label="Filter by Difficulty"
              className="flex-1 px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="ALL">Difficulty</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value as QuestionSource | "ALL");
                setPage(1);
              }}
              aria-label="Filter by Source"
              className="flex-1 px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="ALL">Source</option>
              <option value="Professor">Professor</option>
              <option value="Lecture">Lecture</option>
              <option value="AI Generated">AI Generated</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 pt-1">
          <span className="tabular-nums">
            Showing {filtered.length} matching question{filtered.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-4">
            {pageItems.length > 0 && (
              <button
                type="button"
                onClick={toggleExpandAllOnPage}
                className="text-slate-700 hover:text-slate-900 font-medium"
              >
                {allPageExpanded ? "Collapse All Answers" : "Expand All Answers"}
              </button>
            )}
            {(keyword ||
              lectureFilter !== "ALL" ||
              topicFilter !== "ALL" ||
              typeFilter !== "ALL" ||
              difficultyFilter !== "ALL" ||
              sourceFilter !== "ALL") && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-800 font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Question List */}
      {questions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Question Bank Empty
          </h3>
          <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
            Upload your course files in Uploaded Materials and click &ldquo;Analyze Course&rdquo; to build a comprehensive 300–400+ question bank.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          {preset === "weak"
            ? "No weak areas recorded yet. Answer questions in Practice Mode or Exam Simulation to identify topics needing review."
            : "No questions match the selected filters."}
        </div>
      ) : (
        <div className="space-y-4">
          {pageItems.map((q, idx) => {
            const globalIndex = (safePage - 1) * PAGE_SIZE + idx + 1;
            const isExpanded = Boolean(expandedIds[q.id]);
            const att = attemptMap.get(q.id);

            return (
              <div
                key={q.id}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      Q{globalIndex}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-medium ${
                        q.source === "Professor"
                          ? "text-sky-700"
                          : q.source === "Lecture"
                            ? "text-emerald-700"
                            : "text-slate-600"
                      }`}
                    >
                      {q.source}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{QUESTION_TYPE_LABELS[q.type]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{q.difficulty}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-700 font-medium">{q.lecture}</span>
                    <span aria-hidden="true">·</span>
                    <span>{q.topic}</span>
                  </div>

                  {att && (
                    <span
                      className={`text-xs font-medium ${
                        att.isCorrect ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {att.isCorrect ? "✓ Answered Correctly" : "✕ Needs Review"}
                    </span>
                  )}
                </div>

                <p className="text-base font-medium text-slate-900 leading-relaxed whitespace-pre-wrap">
                  {q.prompt}
                </p>

                {q.figureUrl && (
                  <ProtectedFigure src={q.figureUrl} caption={q.figureCaption} />
                )}

                {q.type === "mcq" && q.options.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {q.options.map((opt, optIdx) => {
                      const letter = String.fromCharCode(65 + optIdx);
                      const isCorrectOpt =
                        isExpanded &&
                        opt.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
                      return (
                        <div
                          key={optIdx}
                          className={`px-4 py-3 text-sm rounded-lg border ${
                            isCorrectOpt
                              ? "bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold"
                              : "bg-slate-50/70 border-slate-200 text-slate-800"
                          }`}
                        >
                          <span className="font-mono font-semibold mr-2">{letter}.</span>
                          <span>{opt}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {q.type === "matching" && q.matchingPairs.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-sm">
                    {q.matchingPairs.map((pair, pIdx) => {
                      const [left, right] = pair.split("||").map((s) => s.trim());
                      return (
                        <div
                          key={pIdx}
                          className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800"
                        >
                          <span className="font-semibold text-slate-900">{left}</span>
                          {isExpanded && right && (
                            <span className="text-emerald-800 font-medium"> → {right}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-500 font-mono">
                    Source: {q.sourceRef}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleExpand(q.id)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-800"
                  >
                    <span>{isExpanded ? "Hide Answer & Solution" : "Show Answer & Solution"}</span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-2 space-y-4">
                    <div className="p-4 sm:p-5 bg-emerald-50/80 border border-emerald-200 rounded-xl">
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 mb-1.5">
                        Correct Answer
                      </p>
                      <p className="text-base sm:text-lg font-semibold text-emerald-950 leading-relaxed whitespace-pre-wrap">
                        {q.correctAnswer}
                      </p>
                    </div>

                    <div className="p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-xl">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                        Step-by-Step Explanation &amp; How to Solve
                      </p>
                      <div className="text-[15px] text-slate-800 leading-7 whitespace-pre-wrap">
                        {q.explanation}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pt-4 flex items-center justify-between text-xs text-slate-600">
              <span className="tabular-nums">
                Page {safePage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 bg-white rounded-md hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 bg-white rounded-md hover:bg-slate-50 disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
