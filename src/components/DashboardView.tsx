import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Subject } from "../types/course";

interface DashboardViewProps {
  studentName: string;
  subjects: Subject[];
  activeSection: "overview" | "subjects" | "banks" | "recent";
  onOpenSubject: (subjectId: string, initialTab?: string) => void;
  onCreateSubject: () => void;
  onEditSubject: (subject: Subject) => void;
  onDeleteSubject: (subject: Subject) => Promise<void>;
}

export function DashboardView({
  studentName,
  subjects,
  activeSection,
  onOpenSubject,
  onCreateSubject,
  onEditSubject,
  onDeleteSubject,
}: DashboardViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const totalFiles = subjects.reduce((sum, s) => sum + (s.materialCount || 0), 0);
  const totalQuestions = subjects.reduce((sum, s) => sum + (s.questionCount || 0), 0);
  const totalAnswered = subjects.reduce((sum, s) => sum + (s.answeredCount || 0), 0);
  const totalCorrect = subjects.reduce((sum, s) => sum + (s.correctCount || 0), 0);
  const overallAccuracy =
    totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const recentlyStudied = [...subjects]
    .filter((s) => Boolean(s.lastStudiedAt?.seconds))
    .sort((a, b) => (b.lastStudiedAt?.seconds || 0) - (a.lastStudiedAt?.seconds || 0))
    .slice(0, 4);

  const filteredSubjects = subjects.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.courseCode.toLowerCase().includes(q) ||
      (s.professorName || "").toLowerCase().includes(q)
    );
  });

  const handleConfirmDelete = async (subject: Subject) => {
    setDeletingId(subject.id);
    try {
      await onDeleteSubject(subject);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="w-full max-w-[1280px] mx-auto px-6 py-8 space-y-10">
      {/* Welcome Header */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-sky-700 mb-1.5">
            Personal Exam Preparation Studio
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
            Welcome back, {studentName.split(" ")[0]}
          </h1>
          <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">
            Manage each university course in its own workspace, analyze lecture materials into structured question banks, and track weak topics before exam day.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter subjects..."
              className="pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 w-56"
            />
          </div>
          <button
            type="button"
            onClick={onCreateSubject}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Subject</span>
          </button>
        </div>
      </section>

      {/* 4-Column Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">My Subjects</p>
          <p className="font-mono text-3xl font-semibold text-slate-900 mt-2 tabular-nums">
            {subjects.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Active course workspaces</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Uploaded Files</p>
          <p className="font-mono text-3xl font-semibold text-slate-900 mt-2 tabular-nums">
            {totalFiles}
          </p>
          <p className="text-xs text-slate-500 mt-1">PDF, DOCX, PPTX, TXT &amp; OCR</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Questions Generated</p>
          <p className="font-mono text-3xl font-semibold text-slate-900 mt-2 tabular-nums">
            {totalQuestions.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1">Across all subject banks</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Study Progress</p>
          <p className="font-mono text-3xl font-semibold text-slate-900 mt-2 tabular-nums">
            {totalAnswered > 0 ? `${overallAccuracy}%` : "0%"}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {totalAnswered > 0
              ? `${totalCorrect} / ${totalAnswered} answered correctly`
              : "No questions answered yet"}
          </p>
        </div>
      </section>

      {/* Recently Studied Section */}
      {(activeSection === "overview" || activeSection === "recent") &&
        recentlyStudied.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Recently Studied Subjects
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {recentlyStudied.map((sub) => {
                const accuracy =
                  sub.answeredCount > 0
                    ? Math.round((sub.correctCount / sub.answeredCount) * 100)
                    : 0;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => onOpenSubject(sub.id, "practice")}
                    className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 hover:bg-slate-50/50 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono font-medium text-slate-700">
                          {sub.courseCode}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{accuracy}% accuracy</span>
                      </div>
                      <p className="font-display font-semibold text-slate-900 truncate">
                        {sub.name}
                      </p>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs font-medium text-sky-700">
                      <span>Resume Practice</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

      {/* Question Banks Quick Table (when 'banks' nav active) */}
      {activeSection === "banks" && subjects.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Subject Question Banks
          </h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Course</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Files</th>
                  <th className="py-3 px-4 text-right">Questions</th>
                  <th className="py-3 px-4 text-right">Completed</th>
                  <th className="py-3 px-4 text-right">Accuracy</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredSubjects.map((sub) => {
                  const pct =
                    sub.answeredCount > 0
                      ? Math.round((sub.correctCount / sub.answeredCount) * 100)
                      : 0;
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{sub.name}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          {sub.courseCode}
                          {sub.professorName ? ` · ${sub.professorName}` : ""}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 capitalize">
                        {sub.analysisStatus === "completed"
                          ? "Ready"
                          : sub.analysisStatus === "analyzing"
                            ? "Analyzing..."
                            : "Needs Analysis"}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {sub.materialCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                        {sub.questionCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {sub.answeredCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {sub.answeredCount > 0 ? `${pct}%` : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenSubject(sub.id, "bank")}
                          className="text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                        >
                          Open Bank →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* My Subjects Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            My Subjects
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            Showing {filteredSubjects.length} of {subjects.length}
          </span>
        </div>

        {subjects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Create your first university subject
            </h3>
            <p className="text-sm text-slate-600 max-w-md mx-auto mt-1.5 mb-6">
              Each subject gets an isolated workspace for lecture materials, a course content map, a 300–400+ question bank, timed exam simulations, and weak-area tracking.
            </p>
            <button
              type="button"
              onClick={onCreateSubject}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Subject</span>
            </button>
          </div>
        ) : filteredSubjects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            No subjects match &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredSubjects.map((sub) => {
              const completionPct =
                sub.questionCount > 0
                  ? Math.min(100, Math.round((sub.answeredCount / sub.questionCount) * 100))
                  : 0;
              const accuracyPct =
                sub.answeredCount > 0
                  ? Math.round((sub.correctCount / sub.answeredCount) * 100)
                  : 0;
              const isConfirmingDelete = confirmDeleteId === sub.id;

              return (
                <div
                  key={sub.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: sub.colorAccent || "#0284C7" }}
                        />
                        <span className="font-mono font-semibold text-slate-700 truncate">
                          {sub.courseCode}
                        </span>
                        {sub.professorName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{sub.professorName}</span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onEditSubject(sub)}
                          aria-label={`Edit ${sub.name}`}
                          className="p-1.5 text-slate-400 hover:text-slate-800 rounded-md hover:bg-slate-100 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeleteId(isConfirmingDelete ? null : sub.id)
                          }
                          aria-label={`Delete ${sub.name}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h3
                      onClick={() => onOpenSubject(sub.id, "overview")}
                      className="font-display text-lg font-semibold text-slate-900 cursor-pointer hover:text-sky-700 transition-colors line-clamp-1"
                    >
                      {sub.name}
                    </h3>

                    {sub.description && (
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                        {sub.description}
                      </p>
                    )}

                    {isConfirmingDelete && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 space-y-2">
                        <p className="font-medium">
                          Delete &ldquo;{sub.name}&rdquo; and all its materials &amp; questions?
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={deletingId === sub.id}
                            onClick={() => handleConfirmDelete(sub)}
                            className="px-2.5 py-1 bg-red-600 text-white font-medium rounded hover:bg-red-700 disabled:opacity-60"
                          >
                            {deletingId === sub.id ? "Deleting..." : "Confirm Delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500 block">Files</span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {sub.materialCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Questions</span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {sub.questionCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Accuracy</span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {sub.answeredCount > 0 ? `${accuracyPct}%` : "—"}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                        <span>Bank Mastery</span>
                        <span className="font-mono tabular-nums">{completionPct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${completionPct}%`,
                            backgroundColor: sub.colorAccent || "#0284C7",
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => onOpenSubject(sub.id, "materials")}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        Upload &amp; Analyze
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSubject(sub.id, "overview")}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-800"
                      >
                        <span>Open Workspace</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
