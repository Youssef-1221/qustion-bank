import React, { useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { auth } from "../lib/firebase";
import { uploadAndExtractFiles } from "../lib/apiClient";
import {
  deleteMaterialWithChunks,
  replaceMaterialFile,
  saveExtractedMaterial,
  updateMaterialFolderOrName,
} from "../lib/firestoreService";
import { CourseMaterial, Subject } from "../types/course";

interface MaterialsPanelProps {
  ownerId: string;
  subject: Subject;
  materials: CourseMaterial[];
  analyzing: boolean;
  analysisProgress: { stage: string; message: string; progressPct: number } | null;
  targetQuestionCount: number;
  onChangeTargetCount: (n: number) => void;
  onAnalyzeCourse: () => Promise<void>;
}

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ fileType }: { fileType: CourseMaterial["fileType"] }) {
  if (fileType === "image") return <FileImage className="w-4 h-4 text-amber-600 shrink-0" />;
  if (fileType === "pptx") return <FileSpreadsheet className="w-4 h-4 text-orange-600 shrink-0" />;
  return <FileText className="w-4 h-4 text-sky-600 shrink-0" />;
}

export function MaterialsPanel({
  ownerId,
  subject,
  materials,
  analyzing,
  analysisProgress,
  targetQuestionCount,
  onChangeTargetCount,
  onAnalyzeCourse,
}: MaterialsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const [folderInput, setFolderInput] = useState("Lecture 1");
  const [selectedFolderFilter, setSelectedFolderFilter] = useState("ALL");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [replacingMaterial, setReplacingMaterial] = useState<CourseMaterial | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<CourseMaterial | null>(null);
  const [editFolder, setEditFolder] = useState("");
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const folders = Array.from(
    new Set(materials.map((m) => m.folder || "General"))
  ).sort();

  const visibleMaterials =
    selectedFolderFilter === "ALL"
      ? materials
      : materials.filter((m) => m.folder === selectedFolderFilter);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploading(true);
    setError(null);
    setUploadStatus(
      `Extracting text & running OCR on ${files.length} file${files.length > 1 ? "s" : ""}...`
    );

    try {
      const extracted = await uploadAndExtractFiles(
        subject.id,
        files,
        (idx, total, fileName) => {
          setUploadStatus(
            `Extracting text (${idx} of ${total}): ${fileName}...`
          );
        }
      );
      let runningCount = materials.length;
      for (const item of extracted) {
        await saveExtractedMaterial(ownerId, subject.id, runningCount, {
          ...item,
          folder: folderInput.trim() || "Lecture 1",
        });
        runningCount += 1;
      }
      setUploadStatus(
        `Uploaded and extracted ${extracted.length} file${extracted.length > 1 ? "s" : ""} successfully.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed.");
      setUploadStatus(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleReplaceFileSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !replacingMaterial) return;
    const file = fileList[0];
    setBusyId(replacingMaterial.id);
    setError(null);
    try {
      const [extracted] = await uploadAndExtractFiles(subject.id, [file]);
      await replaceMaterialFile(ownerId, subject.id, replacingMaterial.id, extracted);
      setUploadStatus(`Replaced "${replacingMaterial.fileName}" with "${extracted.fileName}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replace file.");
    } finally {
      setBusyId(null);
      setReplacingMaterial(null);
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMaterial) return;
    setBusyId(editingMaterial.id);
    try {
      await updateMaterialFolderOrName(
        subject.id,
        editingMaterial.id,
        editFolder,
        editName
      );
      setEditingMaterial(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update file details.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (mat: CourseMaterial) => {
    setBusyId(mat.id);
    setError(null);
    try {
      await deleteMaterialWithChunks(ownerId, subject.id, mat.id, materials.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (mat: CourseMaterial) => {
    if (!mat.storagePath) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch(mat.storagePath, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("File is no longer cached on disk.");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = mat.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download original file.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Analyze Course Action Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            AI Course Analysis &amp; Question Bank Builder
          </h2>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Reads every uploaded file, builds the Course Content Map, extracts professor questions verbatim, and generates comprehensive coverage across all 7 question types.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <label htmlFor="target-q-select" className="font-medium whitespace-nowrap">
              Target Bank Size:
            </label>
            <select
              id="target-q-select"
              value={targetQuestionCount}
              onChange={(e) => onChangeTargetCount(Number(e.target.value))}
              disabled={analyzing}
              className="px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value={300}>300 Questions</option>
              <option value={350}>350 Questions</option>
              <option value={400}>400 Questions</option>
            </select>
          </div>

          <button
            type="button"
            disabled={analyzing || materials.length === 0}
            onClick={onAnalyzeCourse}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {analyzing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>
              {analyzing
                ? "Analyzing Course..."
                : subject.questionCount > 0
                  ? "Re-Analyze Course"
                  : "Analyze Course"}
            </span>
          </button>
        </div>
      </div>

      {/* Live Analysis Progress Bar */}
      {analyzing && analysisProgress && (
        <div className="bg-white border border-sky-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm font-medium text-slate-900">
              <Loader2 className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
              <span>{analysisProgress.message}</span>
            </div>
            <span className="font-mono text-sm font-semibold text-sky-700 tabular-nums shrink-0">
              {analysisProgress.progressPct}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-600 rounded-full transition-all duration-300"
              style={{ width: `${analysisProgress.progressPct}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {uploadStatus && !error && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{uploadStatus}</span>
        </div>
      )}

      {/* Upload Zone */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Upload Course Materials
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Supports PDF (native &amp; scanned OCR), DOCX, PPTX slides, TXT, and JPG/PNG lecture note photos.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              maxLength={100}
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="Lecture / Chapter / Topic"
              aria-label="Folder or Lecture assignment"
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 w-48"
            />
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void handleFilesSelected(e.dataTransfer.files);
          }}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragActive
              ? "border-sky-500 bg-sky-50/50"
              : "border-slate-200 bg-slate-50/50 hover:border-slate-300"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            onChange={(e) => void handleFilesSelected(e.target.files)}
            className="hidden"
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={(e) => void handleReplaceFileSelected(e.target.files)}
            className="hidden"
          />

          <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-700">
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
          </div>
          <p className="text-sm font-medium text-slate-900">
            {uploading
              ? "Extracting text and running OCR..."
              : "Drag & drop course files here, or click to browse"}
          </p>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            Files are assigned to folder &ldquo;{folderInput || "Lecture 1"}&rdquo; (editable anytime)
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            {uploading ? "Processing..." : "Select Files"}
          </button>
        </div>
      </div>

      {/* Folder Tabs + Materials List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setSelectedFolderFilter("ALL")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedFolderFilter === "ALL"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              All Files ({materials.length})
            </button>
            {folders.map((folder) => {
              const count = materials.filter((m) => m.folder === folder).length;
              return (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setSelectedFolderFilter(folder)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    selectedFolderFilter === folder
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {folder} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {visibleMaterials.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No course files uploaded yet. Upload your lecture PDFs, PowerPoint decks, Word handouts, or scanned images above.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleMaterials.map((mat) => (
              <div
                key={mat.id}
                className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <FileIcon fileType={mat.fileType} />
                    <span className="font-medium text-sm text-slate-900 truncate">
                      {mat.fileName}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{mat.folder}</span>
                    <span aria-hidden="true">·</span>
                    <span className="uppercase font-mono">{mat.fileType}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatBytes(mat.fileSize)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {mat.pageCount} {mat.fileType === "pptx" ? "slides" : "pages"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {mat.extractedCharCount.toLocaleString()} chars
                    </span>
                    {mat.ocrUsed && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-700 font-medium">OCR Extracted</span>
                      </>
                    )}
                  </div>

                  {mat.summary && (
                    <p className="mt-1.5 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {mat.summary}
                    </p>
                  )}

                  {editingMaterial?.id === mat.id && (
                    <form
                      onSubmit={handleSaveEdit}
                      className="mt-3 flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="text"
                        required
                        maxLength={100}
                        value={editFolder}
                        onChange={(e) => setEditFolder(e.target.value)}
                        placeholder="Lecture / Chapter"
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-md w-40"
                      />
                      <input
                        type="text"
                        required
                        maxLength={255}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="File name"
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-md w-60"
                      />
                      <button
                        type="submit"
                        disabled={busyId === mat.id}
                        className="px-3 py-1 text-xs font-medium text-white bg-sky-600 rounded-md hover:bg-sky-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingMaterial(null)}
                        className="px-3 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-md"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {mat.storagePath && (
                    <button
                      type="button"
                      onClick={() => void handleDownload(mat)}
                      title="Download original file"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md hover:bg-slate-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === mat.id}
                    onClick={() => {
                      setReplacingMaterial(mat);
                      replaceInputRef.current?.click();
                    }}
                    title="Replace file"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md hover:bg-slate-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Replace</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMaterial(mat);
                      setEditFolder(mat.folder);
                      setEditName(mat.fileName);
                    }}
                    title="Rename or move to folder"
                    className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-md hover:bg-slate-50"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === mat.id}
                    onClick={() => void handleDelete(mat)}
                    title="Delete file"
                    className="p-1.5 text-slate-500 hover:text-red-600 border border-slate-200 rounded-md hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
