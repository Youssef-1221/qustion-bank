import { useEffect, useState } from "react";
import { ImageOff, Loader2, Maximize2, X } from "lucide-react";
import { auth } from "../lib/firebase";

const figureBlobUrlCache = new Map<string, string>();

interface ProtectedFigureProps {
  src?: string;
  caption?: string;
}

export function ProtectedFigure({ src, caption }: ProtectedFigureProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(() =>
    src ? figureBlobUrlCache.get(src) || null : null
  );
  const [loading, setLoading] = useState<boolean>(() =>
    Boolean(src && !figureBlobUrlCache.has(src))
  );
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!src) {
      setObjectUrl(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    const cached = figureBlobUrlCache.get(src);
    if (cached) {
      setObjectUrl(cached);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const resp = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        figureBlobUrlCache.set(src, url);
        if (!cancelled) {
          setObjectUrl(url);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;

  return (
    <>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 space-y-2.5">
        {loading ? (
          <div className="h-36 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
            <span>Loading original file diagram...</span>
          </div>
        ) : failed || !objectUrl ? (
          <div className="h-24 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ImageOff className="w-4 h-4 text-slate-400" />
            <span>Cropped diagram preview unavailable (re-upload &amp; re-analyze to restore).</span>
          </div>
        ) : (
          <div className="relative group bg-white border border-slate-200 rounded-lg p-2 overflow-hidden">
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="block w-full text-center cursor-zoom-in focus:outline-none"
              title="Click to enlarge diagram"
            >
              <img
                src={objectUrl}
                alt={caption || "Cropped course diagram"}
                className="max-h-[420px] w-auto max-w-full object-contain mx-auto rounded"
              />
            </button>
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white/95 border border-slate-200 rounded-md shadow-xs hover:bg-slate-50 absolute bottom-3 right-3"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Enlarge</span>
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{caption || "Cropped directly from course file"}</span>
          <span className="font-mono text-[11px] text-slate-400">Original File Crop</span>
        </div>
      </div>

      {zoomed && objectUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
          onClick={() => setZoomed(false)}
        >
          <div
            className="relative max-w-5xl max-h-[92vh] bg-white rounded-2xl p-4 shadow-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 pb-3 mb-3 border-b border-slate-100">
              <p className="text-sm font-medium text-slate-800">
                {caption || "Original Course Figure"}
              </p>
              <button
                type="button"
                onClick={() => setZoomed(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                aria-label="Close zoomed diagram"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={objectUrl}
              alt={caption || "Enlarged course diagram"}
              className="max-w-full max-h-[78vh] w-auto h-auto mx-auto object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </>
  );
}
