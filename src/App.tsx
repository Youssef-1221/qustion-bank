import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { Loader2, LogOut, Plus } from "lucide-react";
import { DashboardView } from "./components/DashboardView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SignInView } from "./components/SignInView";
import { SubjectModal } from "./components/SubjectModal";
import { SubjectTab, SubjectWorkspace } from "./components/SubjectWorkspace";
import { auth } from "./lib/firebase";
import {
  createSubject,
  deleteSubjectCascade,
  subscribeToSubjects,
  updateSubjectDetails,
  upsertUserProfile,
} from "./lib/firestoreService";
import { Subject } from "./types/course";

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [subjectInitialTab, setSubjectInitialTab] = useState<SubjectTab>("overview");
  const [dashboardSection, setDashboardSection] = useState<
    "overview" | "subjects" | "banks" | "recent"
  >("overview");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        void upsertUserProfile(firebaseUser);
      } else {
        setSubjects([]);
        setSelectedSubjectId(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const unsub = subscribeToSubjects(user.uid, setSubjects);
    return () => unsub();
  }, [authReady, user]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
          <span>Loading CourseBank...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignInView />;
  }

  const activeSubject = subjects.find((s) => s.id === selectedSubjectId) || null;

  const handleSaveSubject = async (data: {
    name: string;
    courseCode: string;
    professorName: string;
    description: string;
    colorAccent: string;
  }) => {
    if (editingSubject) {
      await updateSubjectDetails(editingSubject.id, data);
    } else {
      const newId = await createSubject(user.uid, data);
      setSelectedSubjectId(newId);
      setSubjectInitialTab("materials");
    }
  };

  const handleDeleteSubject = async (subject: Subject) => {
    await deleteSubjectCascade(user.uid, subject.id);
    if (selectedSubjectId === subject.id) {
      setSelectedSubjectId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="w-full max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => {
              setSelectedSubjectId(null);
              setDashboardSection("overview");
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            CourseBank
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {(
              [
                ["overview", "Dashboard"],
                ["subjects", "My Subjects"],
                ["banks", "Question Banks"],
                ["recent", "Recent Study"],
              ] as const
            ).map(([sec, label]) => {
              const isActive = !activeSubject && dashboardSection === sec;
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    setSelectedSubjectId(null);
                    setDashboardSection(sec);
                  }}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? "border-sky-600 text-slate-900"
                      : "border-transparent hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditingSubject(null);
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Subject</span>
            </button>
            <button
              type="button"
              onClick={() => void signOut(auth)}
              title={`Sign out (${user.email || "Account"})`}
              aria-label="Sign out"
              className="p-2 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1">
        {activeSubject ? (
          <SubjectWorkspace
            ownerId={user.uid}
            subject={activeSubject}
            initialTab={subjectInitialTab}
            onBack={() => setSelectedSubjectId(null)}
          />
        ) : (
          <DashboardView
            studentName={user.displayName || user.email || "Student"}
            subjects={subjects}
            activeSection={dashboardSection}
            onOpenSubject={(id, tab) => {
              setSelectedSubjectId(id);
              setSubjectInitialTab((tab as SubjectTab) || "overview");
            }}
            onCreateSubject={() => {
              setEditingSubject(null);
              setModalOpen(true);
            }}
            onEditSubject={(sub) => {
              setEditingSubject(sub);
              setModalOpen(true);
            }}
            onDeleteSubject={handleDeleteSubject}
          />
        )}
      </div>

      <SubjectModal
        open={modalOpen}
        editingSubject={editingSubject}
        onClose={() => {
          setModalOpen(false);
          setEditingSubject(null);
        }}
        onSubmit={handleSaveSubject}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
