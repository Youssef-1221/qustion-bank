import { Play } from "lucide-react";
import {
  QUESTION_TYPE_LABELS,
  QuestionAttempt,
  QuestionItem,
  QuestionType,
} from "../types/course";

interface AnalyticsPanelProps {
  questions: QuestionItem[];
  attempts: QuestionAttempt[];
  onPracticeWeakAreas: (weakQuestions: QuestionItem[], label: string) => void;
}

export function AnalyticsPanel({
  questions,
  attempts,
  onPracticeWeakAreas,
}: AnalyticsPanelProps) {
  const totalGenerated = questions.length;
  const completedCount = attempts.length;
  const correctCount = attempts.filter((a) => a.isCorrect).length;
  const incorrectCount = completedCount - correctCount;
  const overallPct =
    completedCount > 0 ? Math.round((correctCount / completedCount) * 100) : 0;

  // Performance by Lecture
  const lectures = Array.from(new Set(questions.map((q) => q.lecture))).sort();
  const lectureRows = lectures.map((lec) => {
    const qInLec = questions.filter((q) => q.lecture === lec);
    const attInLec = attempts.filter((a) => a.lecture === lec);
    const cor = attInLec.filter((a) => a.isCorrect).length;
    const pct = attInLec.length > 0 ? Math.round((cor / attInLec.length) * 100) : 0;
    return {
      lecture: lec,
      total: qInLec.length,
      completed: attInLec.length,
      correct: cor,
      incorrect: attInLec.length - cor,
      accuracy: pct,
    };
  });

  // Performance by Question Type
  const typeRows = (Object.keys(QUESTION_TYPE_LABELS) as QuestionType[])
    .map((type) => {
      const total = questions.filter((q) => q.type === type).length;
      const att = attempts.filter((a) => a.questionType === type);
      const cor = att.filter((a) => a.isCorrect).length;
      const pct = att.length > 0 ? Math.round((cor / att.length) * 100) : 0;
      return {
        type,
        label: QUESTION_TYPE_LABELS[type],
        total,
        completed: att.length,
        correct: cor,
        accuracy: pct,
      };
    })
    .filter((r) => r.total > 0);

  // Topics Needing More Practice (Weak Areas)
  const topicMap = new Map<
    string,
    { topic: string; lecture: string; total: number; incorrect: number; accuracy: number }
  >();
  for (const a of attempts) {
    const cur = topicMap.get(a.topic) || {
      topic: a.topic,
      lecture: a.lecture,
      total: 0,
      incorrect: 0,
      accuracy: 0,
    };
    cur.total += 1;
    if (!a.isCorrect) cur.incorrect += 1;
    cur.accuracy = Math.round(((cur.total - cur.incorrect) / cur.total) * 100);
    topicMap.set(a.topic, cur);
  }

  const weakTopics = [...topicMap.values()]
    .filter((t) => t.incorrect > 0)
    .sort((a, b) => a.accuracy - b.accuracy || b.incorrect - a.incorrect);

  const handlePracticeAllWeak = () => {
    const weakSet = new Set(weakTopics.map((t) => t.topic));
    const wrongIds = new Set(attempts.filter((a) => !a.isCorrect).map((a) => a.questionId));
    const targeted = questions.filter(
      (q) => wrongIds.has(q.id) || weakSet.has(q.topic)
    );
    onPracticeWeakAreas(targeted, "Weak Areas Drill");
  };

  return (
    <div className="space-y-8">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Questions</p>
          <p className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
            {totalGenerated}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Completed</p>
          <p className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
            {completedCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Correct Answers</p>
          <p className="font-mono text-2xl font-semibold text-emerald-700 mt-1 tabular-nums">
            {correctCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Incorrect Answers</p>
          <p className="font-mono text-2xl font-semibold text-red-700 mt-1 tabular-nums">
            {incorrectCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Overall Performance</p>
          <p className="font-mono text-2xl font-semibold text-sky-700 mt-1 tabular-nums">
            {completedCount > 0 ? `${overallPct}%` : "—"}
          </p>
        </div>
      </div>

      {/* Weak Areas Focus */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Topics Needing More Practice
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatically tracks incorrect answers across Practice Mode and Exam Simulations.
            </p>
          </div>
          {weakTopics.length > 0 && (
            <button
              type="button"
              onClick={handlePracticeAllWeak}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Practice Weak Areas</span>
            </button>
          )}
        </div>

        {weakTopics.length === 0 ? (
          <p className="text-sm text-slate-500">
            {completedCount === 0
              ? "Answer questions in Practice Mode or Exam Simulation to identify weak topics."
              : "No weak topics flagged — 100% accuracy on attempted questions so far."}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {weakTopics.map((wt) => (
              <div
                key={wt.topic}
                className="py-3 flex flex-wrap items-center justify-between gap-4 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{wt.topic}</p>
                  <p className="text-xs text-slate-500">
                    {wt.lecture} · {wt.incorrect} incorrect out of {wt.total} attempted
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs font-semibold text-red-700 tabular-nums">
                    {wt.accuracy}% accuracy
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const topicQs = questions.filter((q) => q.topic === wt.topic);
                      onPracticeWeakAreas(topicQs, `Weak Area: ${wt.topic}`);
                    }}
                    className="text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                  >
                    Drill Topic →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Performance by Lecture & Type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Performance by Lecture
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Lecture</th>
                  <th className="py-2.5 px-4 font-medium text-right">Bank</th>
                  <th className="py-2.5 px-4 font-medium text-right">Done</th>
                  <th className="py-2.5 px-4 font-medium text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lectureRows.map((row) => (
                  <tr key={row.lecture}>
                    <td className="py-2.5 px-4 font-medium text-slate-800">
                      {row.lecture}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {row.total}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {row.completed}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {row.completed > 0 ? `${row.accuracy}%` : "—"}
                    </td>
                  </tr>
                ))}
                {lectureRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No lecture data available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Performance by Question Type
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Question Type</th>
                  <th className="py-2.5 px-4 font-medium text-right">Bank</th>
                  <th className="py-2.5 px-4 font-medium text-right">Done</th>
                  <th className="py-2.5 px-4 font-medium text-right">Accuracy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {typeRows.map((row) => (
                  <tr key={row.type}>
                    <td className="py-2.5 px-4 font-medium text-slate-800">
                      {row.label}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {row.total}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {row.completed}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {row.completed > 0 ? `${row.accuracy}%` : "—"}
                    </td>
                  </tr>
                ))}
                {typeRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No question breakdown available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
