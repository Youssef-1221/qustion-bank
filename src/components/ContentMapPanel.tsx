import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Play } from "lucide-react";
import { ContentMapNode } from "../types/course";

interface ContentMapPanelProps {
  nodes: ContentMapNode[];
  onPracticeTopic: (lecture: string, topic: string) => void;
}

export function ContentMapPanel({ nodes, onPracticeTopic }: ContentMapPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(nodes[0]?.id || null);

  if (nodes.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
        <h3 className="font-display text-base font-semibold text-slate-900">
          Course Content Map Not Built Yet
        </h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto mt-1">
          Upload your lecture materials and click &ldquo;Analyze Course&rdquo; to map every lecture, topic, definition, equation, and example.
        </p>
      </div>
    );
  }

  // Group nodes by lecture
  const lectures = Array.from(new Set(nodes.map((n) => n.lecture)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Course Content Map
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {lectures.length} lectures / units · {nodes.length} mapped topics
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {lectures.map((lectureName) => {
          const lectureNodes = nodes.filter((n) => n.lecture === lectureName);
          return (
            <section
              key={lectureName}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  {lectureName}
                </h3>
                <span className="text-xs font-mono text-slate-500 tabular-nums">
                  {lectureNodes.length} {lectureNodes.length === 1 ? "topic" : "topics"}
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {lectureNodes.map((node) => {
                  const isOpen = expandedId === node.id;
                  return (
                    <div key={node.id}>
                      <div className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/50">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : node.id)}
                          className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-slate-900 truncate">
                              {node.topic}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                              {node.definitions.length} definitions · {node.formulas.length} formulas · {node.examples.length} examples
                            </p>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => onPracticeTopic(node.lecture, node.topic)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          <Play className="w-3 h-3" />
                          <span>Practice Topic</span>
                        </button>
                      </div>

                      {isOpen && (
                        <div className="px-11 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                          {node.subtopics.length > 0 && (
                            <div>
                              <p className="font-semibold text-slate-800 mb-1.5">
                                Subtopics Covered
                              </p>
                              <ul className="space-y-1 text-slate-600 list-disc pl-4">
                                {node.subtopics.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {node.definitions.length > 0 && (
                            <div>
                              <p className="font-semibold text-slate-800 mb-1.5">
                                Key Definitions &amp; Concepts
                              </p>
                              <ul className="space-y-1 text-slate-600 list-disc pl-4">
                                {node.definitions.map((d, i) => (
                                  <li key={i}>{d}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {node.formulas.length > 0 && (
                            <div>
                              <p className="font-semibold text-slate-800 mb-1.5">
                                Equations &amp; Formulas
                              </p>
                              <ul className="space-y-1.5 font-mono text-slate-800">
                                {node.formulas.map((f, i) => (
                                  <li
                                    key={i}
                                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md"
                                  >
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {node.examples.length > 0 && (
                            <div>
                              <p className="font-semibold text-slate-800 mb-1.5">
                                Worked Examples &amp; Applications
                              </p>
                              <ul className="space-y-1 text-slate-600 list-disc pl-4">
                                {node.examples.map((ex, i) => (
                                  <li key={i}>{ex}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {node.sourceFiles.length > 0 && (
                            <div className="md:col-span-2 pt-2 border-t border-slate-100 text-slate-500">
                              <span className="font-medium text-slate-700">Sources: </span>
                              {node.sourceFiles.join(" · ")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
