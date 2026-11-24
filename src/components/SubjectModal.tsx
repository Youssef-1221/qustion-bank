import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Subject, SUBJECT_ACCENTS } from "../types/course";

interface SubjectModalProps {
  open: boolean;
  editingSubject: Subject | null;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    courseCode: string;
    professorName: string;
    description: string;
    colorAccent: string;
  }) => Promise<void>;
}

export function SubjectModal({
  open,
  editingSubject,
  onClose,
  onSubmit,
}: SubjectModalProps) {
  const [name, setName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [professorName, setProfessorName] = useState("");
  const [description, setDescription] = useState("");
  const [colorAccent, setColorAccent] = useState(SUBJECT_ACCENTS[0].hex);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(editingSubject?.name || "");
      setCourseCode(editingSubject?.courseCode || "");
      setProfessorName(editingSubject?.professorName || "");
      setDescription(editingSubject?.description || "");
      setColorAccent(editingSubject?.colorAccent || SUBJECT_ACCENTS[0].hex);
      setError(null);
    }
  }, [open, editingSubject]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !courseCode.trim()) {
      setError("Subject name and course code are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        courseCode: courseCode.trim().toUpperCase(),
        professorName: professorName.trim(),
        description: description.trim(),
        colorAccent,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save subject.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            {editingSubject ? "Edit Subject" : "Create University Subject"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Subject Name
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Engineering Thermodynamics"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Course Code
              </label>
              <input
                type="text"
                required
                maxLength={32}
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="e.g. ME-301"
                className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Professor&apos;s Name <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              maxLength={100}
              value={professorName}
              onChange={(e) => setProfessorName(e.target.value)}
              placeholder="e.g. Dr. Elena Vance"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Course Scope / Notes <span className="text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Midterm & final exam preparation, lectures 1–12..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-2">
              Workspace Color Marker
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {SUBJECT_ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  onClick={() => setColorAccent(accent.hex)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    colorAccent === accent.hex
                      ? "border-slate-900 bg-slate-100 text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: accent.hex }}
                  />
                  <span>{accent.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-60 transition-colors"
            >
              {saving
                ? "Saving..."
                : editingSubject
                  ? "Save Changes"
                  : "Create Subject"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
