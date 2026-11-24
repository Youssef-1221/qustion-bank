import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  FileText,
  FolderOpen,
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import { streamCourseAnalysis } from "../lib/apiClient";
import {
  clearAndSaveContentMap,
  clearSubjectQuestions,
  fetchAllMaterialTexts,
  saveQuestionsBatch,
  subscribeToAttempts,
  subscribeToContentMap,
  subscribeToExams,
  subscribeToQuestions,
  subscribeToSubjectMaterials,
  syncSubjectQuestionCount,
  updateSubjectAnalysis,
} from "../lib/firestoreService";
import {
  ContentMapNode,
  CourseMaterial,
  ExamSimulation,
  QUESTION_TYPE_LABELS,
  QuestionAttempt,
  QuestionItem,
  QuestionType,
  Subject,
} from "../types/course";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { ContentMapPanel } from "./ContentMapPanel";
import { ExamSimulationPanel } from "./ExamSimulationPanel";
import { MaterialsPanel } from "./MaterialsPanel";
import { PracticeModePanel } from "./PracticeModePanel";
import { BankPreset, QuestionBankPanel } from "./QuestionBankPanel";

export type SubjectTab =
  | "overview"
  | "materials"
  | "map"
  | "bank"
  | "exam"
  | "practice"
  | "analytics";

interface SubjectWorkspaceProps {
  ownerId: string;
  subject: Subject;
  initialTab?: SubjectTab;
  onBack: () => void;
}

export function SubjectWorkspace({
  ownerId,
  subject,
  initialTab = "overview",
  onBack,
}: SubjectWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<SubjectTab>(initialTab);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [contentMap, setContentMap] = useState<ContentMapNode[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [attempts, setAttempts] = useState<QuestionAttempt[]>([]);
  const [exams, setExams] = useState<ExamSimulation[]>([]);

  const [analyzing, setAnalyzing] = useState(false);
  const [targetCount, setTargetCount] = useState(320);
  const [analysisProgress, setAnalysisProgress] = useState<{
    stage: string;
    message: string;
    progressPct: number;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [bankPreset, setBankPreset] = useState<BankPreset>("all");
  const [practiceMode, setPracticeMode] = useState<
    "all" | "professor" | "ai" | "weak" | "custom"
  >("all");
  const [customPracticeQuestions, setCustomPracticeQuestions] = useState<
    QuestionItem[]
  >([]);
  const [customPracticeLabel, setCustomPracticeLabel] = useState("All Questions");

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, subject.id]);

  useEffect(() => {
    setQuestionsLoaded(false);
    const unsubMat = subscribeToSubjectMaterials(ownerId, subject.id, setMaterials);
    const unsubMap = subscribeToContentMap(ownerId, subject.id, setContentMap);
    const unsubQ = subscribeToQuestions(ownerId, subject.id, (qs) => {
      setQuestions(qs);
      setQuestionsLoaded(true);
    });
    const unsubAtt = subscribeToAttempts(ownerId, subject.id, setAttempts);
    const unsubEx = subscribeToExams(ownerId, subject.id, setExams);
    return () => {
      unsubMat();
      unsubMap();
      unsubQ();
      unsubAtt();
      unsubEx();
    };
  }, [ownerId, subject.id]);

  // Keep subject.questionCount strictly synchronized with actual persisted Firestore questions
  useEffect(() => {
    if (
      questionsLoaded &&
      !analyzing &&
      subject.analysisStatus !== "analyzing" &&
      questions.length !== subject.questionCount
    ) {
      void syncSubjectQuestionCount(subject.id, questions.length);
    }
  }, [
    questionsLoaded,
    analyzing,
    subject.id,
    subject.analysisStatus,
    subject.questionCount,
    questions.length,
  ]);

  const attemptMap = useMemo(() => {
    const m = new Map<string, QuestionAttempt>();
    for (const a of attempts) m.set(a.questionId, a);
    return m;
  }, [attempts]);

  const practiceQuestions = useMemo(() => {
    if (practiceMode === "custom") return customPracticeQuestions;
    if (practiceMode === "professor") {
      return questions.filter((q) => q.source === "Professor");
    }
    if (practiceMode === "ai") {
      return questions.filter((q) => q.source === "AI Generated");
    }
    if (practiceMode === "weak") {
      const topicStats = new Map<string, { wrong: number; total: number }>();
      for (const a of attempts) {
        const cur = topicStats.get(a.topic) || { wrong: 0, total: 0 };
        cur.total += 1;
        if (!a.isCorrect) cur.wrong += 1;
        topicStats.set(a.topic, cur);
      }
      const weakTopics = new Set<string>();
      for (const [t, s] of topicStats.entries()) {
        if (s.wrong > 0 && s.wrong / s.total >= 0.4) weakTopics.add(t);
      }
      return questions.filter((q) => {
        const att = attemptMap.get(q.id);
        return (att && !att.isCorrect) || weakTopics.has(q.topic);
      });
    }
    return questions;
  }, [practiceMode, customPracticeQuestions, questions, attempts, attemptMap]);

  const handleAnalyzeCourse = async () => {
    if (materials.length === 0 || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisProgress({
      stage: "loading",
      message: "Loading extracted course materials from database...",
      progressPct: 5,
    });

    let savedTotal = 0;
    let latestSummary = subject.analysisSummary || "";

    try {
      await updateSubjectAnalysis(subject.id, {
        analysisStatus: "analyzing",
        analysisSummary: latestSummary,
        questionCount: 0,
        materialCount: materials.length,
      });

      const materialTexts = await fetchAllMaterialTexts(
        ownerId,
        subject.id,
        materials
      );

      await clearSubjectQuestions(ownerId, subject.id);

      await streamCourseAnalysis(
        {
          subjectId: subject.id,
          subjectName: subject.name,
          courseCode: subject.courseCode,
          targetCount,
          materials: materialTexts,
        },
        {
          onStage: (stageInfo) => {
            setAnalysisProgress(stageInfo);
          },
          onContentMap: async ({ courseSummary, nodes }) => {
            latestSummary = courseSummary;
            await clearAndSaveContentMap(ownerId, subject.id, nodes);
          },
          onQuestions: async ({ questions: batch }) => {
            const added = await saveQuestionsBatch(ownerId, subject.id, batch);
            savedTotal += added;
            await updateSubjectAnalysis(subject.id, {
              analysisStatus: "analyzing",
              analysisSummary: latestSummary,
              questionCount: savedTotal,
              materialCount: materials.length,
            });
          },
          onComplete: async ({ courseSummary }) => {
            latestSummary = courseSummary || latestSummary;
            await updateSubjectAnalysis(subject.id, {
              analysisStatus: "completed",
              analysisSummary: latestSummary,
              questionCount: savedTotal,
              materialCount: materials.length,
            });
            setAnalysisProgress({
              stage: "completed",
              message: `Analysis complete — ${savedTotal} unique questions saved.`,
              progressPct: 100,
            });
          },
          onError: (msg) => {
            throw new Error(msg);
          },
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Course analysis failed.";
      setAnalysisError(msg);
      await updateSubjectAnalysis(subject.id, {
        analysisStatus: "error",
        analysisSummary: latestSummary,
        questionCount: savedTotal,
        materialCount: materials.length,
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const navItems: { id: SubjectTab; label: string; icon: typeof BookOpen; count?: number }[] = [
    { id: "overview", label: "Subject Overview", icon: BookOpen },
    { id: "materials", label: "Uploaded Materials", icon: FolderOpen, count: materials.length },
    { id: "map", label: "Course Content Map", icon: Layers, count: contentMap.length },
    { id: "bank", label: "Question Bank", icon: ListChecks, count: questions.length },
    { id: "exam", label: "Exam Simulation", icon: GraduationCap, count: exams.length },
    { id: "practice", label: "Practice Mode", icon: Play },
    { id: "analytics", label: "Performance Analytics", icon: BarChart3 },
  ];

  const profCount = questions.filter((q) => q.source === "Professor").length;
  const lectureCount = questions.filter((q) => q.source === "Lecture").length;
  const aiCount = questions.filter((q) => q.source === "AI Generated").length;
  const accuracy =
    attempts.length > 0
      ? Math.round(
          (attempts.filter((a) => a.isCorrect).length / attempts.length) * 100
        )
      : 0;

  return (
    <div className="w-full max-w-[1400px] mx-auto px-6 py-6">
      {/* Breadcrumb + Subject Header */}
      <div className="pb-5 mb-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to All Subjects</span>
          </button>
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: subject.colorAccent || "#0284C7" }}
            />
            <span className="font-mono text-sm font-semibold text-slate-600">
              {subject.courseCode}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              /
            </span>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              {subject.name}
            </h1>
            {subject.professorName && (
              <span className="text-xs text-slate-500">
                · {subject.professorName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={analyzing || materials.length === 0}
            onClick={() => {
              setActiveTab("materials");
              void handleAnalyzeCourse();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            {analyzing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>
              {analyzing
                ? "Analyzing..."
                : questions.length > 0
                  ? "Re-Analyze Course"
                  : "Analyze Course"}
            </span>
          </button>
        </div>
      </div>

      {analysisError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
          {analysisError}
        </div>
      )}

      {/* Workspace Shell: Sidebar + Main Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-3">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? "bg-white text-sky-700 border border-slate-200 shadow-xs"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.count !== undefined && (
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="lg:col-span-9 min-w-0">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Overview Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs text-slate-500">Uploaded Files</p>
                  <p className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                    {materials.length}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs text-slate-500">Question Bank</p>
                  <p className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                    {questions.length}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs text-slate-500">Professor Questions</p>
                  <p className="font-mono text-2xl font-semibold text-sky-700 mt-1 tabular-nums">
                    {profCount}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs text-slate-500">Practice Accuracy</p>
                  <p className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                    {attempts.length > 0 ? `${accuracy}%` : "—"}
                  </p>
                </div>
              </div>

              {/* Course Summary & Next Action */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Course Overview
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {subject.analysisSummary ||
                    subject.description ||
                    "Upload your course files in Uploaded Materials and click Analyze Course to extract every professor question, build your Content Map, and generate a 300–400+ question bank."}
                </p>

                <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab("materials")}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 rounded-lg hover:bg-slate-200"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Manage Uploaded Files</span>
                  </button>
                  {questions.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setPracticeMode("all");
                          setActiveTab("practice");
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Start Practice Mode</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab("exam")}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        <GraduationCap className="w-3.5 h-3.5" />
                        <span>Launch Exam Simulation</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Question Source & Type Breakdown */}
              {questions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      Question Provenance Breakdown
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">Original Professor Questions</span>
                        <span className="font-mono font-semibold text-sky-700 tabular-nums">
                          {profCount}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">Lecture-Derived Questions</span>
                        <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                          {lectureCount}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">AI-Generated Coverage Questions</span>
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {aiCount}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      Question Types Distribution
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => {
                        const c = questions.filter((q) => q.type === t).length;
                        return (
                          <div key={t} className="flex items-center justify-between py-1">
                            <span className="text-slate-600 truncate pr-2">
                              {QUESTION_TYPE_LABELS[t]}
                            </span>
                            <span className="font-mono font-semibold text-slate-900 tabular-nums">
                              {c}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "materials" && (
            <MaterialsPanel
              ownerId={ownerId}
              subject={subject}
              materials={materials}
              analyzing={analyzing}
              analysisProgress={analysisProgress}
              targetQuestionCount={targetCount}
              onChangeTargetCount={setTargetCount}
              onAnalyzeCourse={handleAnalyzeCourse}
            />
          )}

          {activeTab === "map" && (
            <ContentMapPanel
              nodes={contentMap}
              onPracticeTopic={(lecture, topic) => {
                const matching = questions.filter(
                  (q) => q.lecture === lecture && q.topic === topic
                );
                setCustomPracticeQuestions(matching);
                setCustomPracticeLabel(`${lecture} · ${topic}`);
                setPracticeMode("custom");
                setActiveTab("practice");
              }}
            />
          )}

          {activeTab === "bank" && (
            <QuestionBankPanel
              questions={questions}
              attempts={attempts}
              initialPreset={bankPreset}
              onStartPractice={(filteredQs, label) => {
                setCustomPracticeQuestions(filteredQs);
                setCustomPracticeLabel(label);
                setPracticeMode("custom");
                setActiveTab("practice");
              }}
            />
          )}

          {activeTab === "exam" && (
            <ExamSimulationPanel
              ownerId={ownerId}
              subjectId={subject.id}
              subjectName={subject.name}
              questions={questions}
              attempts={attempts}
              exams={exams}
            />
          )}

          {activeTab === "practice" && (
            <PracticeModePanel
              ownerId={ownerId}
              subjectId={subject.id}
              questions={practiceQuestions}
              attempts={attempts}
              activeMode={practiceMode}
              sessionLabel={
                practiceMode === "custom"
                  ? customPracticeLabel
                  : practiceMode === "professor"
                    ? "Professor Questions Only"
                    : practiceMode === "ai"
                      ? "AI Generated Questions"
                      : practiceMode === "weak"
                        ? "Weak Areas Practice"
                        : "All Questions"
              }
              onChangeMode={(mode) => {
                setPracticeMode(mode);
                setBankPreset(mode);
              }}
            />
          )}

          {activeTab === "analytics" && (
            <AnalyticsPanel
              questions={questions}
              attempts={attempts}
              onPracticeWeakAreas={(weakQs, label) => {
                setCustomPracticeQuestions(weakQs);
                setCustomPracticeLabel(label);
                setPracticeMode("custom");
                setActiveTab("practice");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
