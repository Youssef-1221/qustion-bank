import { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { ArrowRight, BookOpenCheck, FileSearch, Layers, Target } from "lucide-react";
import { auth, googleProvider } from "../lib/firebase";

export function SignInView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not complete Google sign-in.";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="w-full max-w-[1280px] mx-auto px-6 py-5 flex items-center justify-between gap-8 border-b border-slate-200">
        <span className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          CourseBank
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a href="#workflow" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Workflow
          </a>
          <a href="#formats" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Supported Formats
          </a>
          <a href="#modes" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Study Modes
          </a>
        </nav>
        <div className="shrink-0">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-2">
            <div>
              <p className="text-sm font-medium text-sky-700 mb-3">
                University Exam Preparation Workspace
              </p>
              <h1 className="font-display text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12] mb-5 [text-wrap:balance]">
                Turn full course materials into a verified 300+ question bank.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
                Create a dedicated workspace for every university subject, upload lecture slides, PDFs, Word documents, and scanned handwritten notes, and let CourseBank map the syllabus while prioritizing your professor&apos;s original questions.
              </p>

              {error && (
                <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <span>{loading ? "Connecting..." : "Continue with Google"}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-500">
                  Private cloud-synced workspaces · Persistent exam history
                </span>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-3 gap-6">
              <div>
                <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  300–400+
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Questions per subject
                </p>
              </div>
              <div>
                <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  7 Types
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  MCQ, Numerical, Essay &amp; more
                </p>
              </div>
              <div>
                <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  6 Modes
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Exam Sim, Practice &amp; Weak Areas
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[340px] rounded-xl overflow-hidden border border-slate-200 bg-white">
              {!imgFailed ? (
                <img
                  src="/src/assets/images/welcome_study_workspace_1795519543523.jpg"
                  alt="University student desk with open engineering textbook, equations, and structured lecture notes"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full min-h-[340px] bg-gradient-to-br from-slate-100 via-sky-50 to-slate-200 flex flex-col items-center justify-center p-8 text-center">
                  <BookOpenCheck className="w-12 h-12 text-sky-700 mb-3" />
                  <p className="font-display text-lg font-semibold text-slate-900">
                    Structured Course Workspaces
                  </p>
                  <p className="text-sm text-slate-600 mt-1 max-w-sm">
                    Upload PDFs, PowerPoint decks, Word notes, and scanned pages for complete syllabus coverage.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <section id="workflow" className="mt-16 pt-12 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div id="formats">
            <div className="flex items-center gap-2.5 text-slate-900 font-display font-semibold text-base mb-2">
              <FileSearch className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Multi-Format Ingestion &amp; OCR</span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Reads PDF, DOCX, PPTX slides and speaker notes, TXT, and scanned JPG/PNG handwritten notes. Preserves exact slide and page references.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2.5 text-slate-900 font-display font-semibold text-base mb-2">
              <Layers className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Professor-First Extraction</span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Extracts your professor&apos;s explicit exam and assignment questions verbatim first, then maps every definition, formula, and concept to fill gaps.
            </p>
          </div>
          <div id="modes">
            <div className="flex items-center gap-2.5 text-slate-900 font-display font-semibold text-base mb-2">
              <Target className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Timed Exams &amp; Weak Areas</span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Customize timed exam simulations, drill step-by-step numerical solutions in Practice Mode, and target weak topics automatically.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
