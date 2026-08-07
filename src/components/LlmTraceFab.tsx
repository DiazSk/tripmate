"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Terminal, X } from "lucide-react";
import TraceStatusBadge from "@/components/TraceStatusBadge";
import { TraceDetail, TraceSummary } from "@/lib/types";

type View = "list" | "detail";

interface LlmTraceWidgetApi {
  openList: () => void;
  openItem: (id: string) => void;
  close: () => void;
}

const LlmTraceWidgetContext = createContext<LlmTraceWidgetApi | null>(null);

/** Lets any "View LLM trace for this call →" link open the FAB panel
 *  pre-focused on that trace, instead of navigating to a page that no longer
 *  exists — see .claude/skills/dev-analytics-fab/SKILL.md. */
export function useLlmTraceWidget(): LlmTraceWidgetApi {
  const ctx = useContext(LlmTraceWidgetContext);
  if (!ctx) throw new Error("useLlmTraceWidget must be used within <LlmTraceFabProvider>");
  return ctx;
}

export function LlmTraceFabProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openList = useCallback(() => {
    setView("list");
    setSelectedId(null);
    setIsOpen(true);
  }, []);

  const openItem = useCallback((id: string) => {
    setView("detail");
    setSelectedId(id);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <LlmTraceWidgetContext.Provider value={{ openList, openItem, close }}>
      {children}
      <LlmTraceFab
        isOpen={isOpen}
        view={view}
        selectedId={selectedId}
        onOpen={openList}
        onClose={close}
        onSelect={(id) => {
          setView("detail");
          setSelectedId(id);
        }}
        onBackToList={() => {
          setView("list");
          setSelectedId(null);
        }}
      />
    </LlmTraceWidgetContext.Provider>
  );
}

function TraceList({ onSelect }: { onSelect: (id: string) => void }) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/llm-traces")
      .then((res) => res.json())
      .then((data) => setTraces(data.traces))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-4 text-sm text-stone-500">Loading…</p>;
  if (traces.length === 0) return <p className="p-4 text-sm text-stone-500">No calls logged yet.</p>;

  return (
    <div className="space-y-2 overflow-y-auto p-3">
      {traces.map((trace) => (
        <button
          key={trace.id}
          onClick={() => onSelect(trace.id)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50"
        >
          <div className="min-w-0">
            <div className="font-medium capitalize text-stone-900">{trace.type}</div>
            <div className="truncate text-xs text-stone-500">
              {new Date(trace.createdAt).toLocaleString()}
              {trace.durationMs != null && ` · ${trace.durationMs}ms`}
            </div>
          </div>
          <TraceStatusBadge status={trace.status} />
        </button>
      ))}
    </div>
  );
}

// Keyed by `id` at the call site (below) so switching traces remounts this
// fresh — simpler and lint-clean than resetting trace/error state by hand
// inside the effect every time `id` changes.
function TraceDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/llm-traces/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load trace");
        setTrace(data);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <button
        onClick={onBack}
        className="mb-2 flex items-center gap-1.5 self-start text-sm font-medium text-stone-600 hover:text-stone-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to list
      </button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {!trace && !error && <p className="text-sm text-stone-500">Loading…</p>}

      {trace && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span className="font-medium capitalize text-stone-900">{trace.type}</span>
            <span>·</span>
            <span>{trace.model}</span>
            <span>·</span>
            <span>{new Date(trace.createdAt).toLocaleString()}</span>
            {trace.durationMs != null && (
              <>
                <span>·</span>
                <span>{trace.durationMs}ms</span>
              </>
            )}
            <TraceStatusBadge status={trace.status} />
          </div>

          {trace.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {trace.errorMessage}
            </div>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-stone-700">Prompt sent to Claude</h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-800">
              {trace.prompt}
            </pre>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-stone-700">Raw response</h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-800">
              {trace.rawResponse ?? "(no response captured)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function LlmTraceFab({
  isOpen,
  view,
  selectedId,
  onOpen,
  onClose,
  onSelect,
  onBackToList,
}: {
  isOpen: boolean;
  view: View;
  selectedId: string | null;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onBackToList: () => void;
}) {
  return (
    <>
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="fab"
            onClick={onOpen}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-stone-900 text-white shadow-lg transition-transform hover:scale-105"
            aria-label="Open LLM trace viewer"
            title="LLM trace viewer"
          >
            <Terminal className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 16 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[23rem] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Terminal className="h-4 w-4 text-stone-500" />
                LLM trace
              </div>
              <button
                onClick={onClose}
                aria-label="Collapse LLM trace viewer"
                title="Collapse"
                className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {view === "list" ? (
                <TraceList onSelect={onSelect} />
              ) : selectedId ? (
                <TraceDetailView key={selectedId} id={selectedId} onBack={onBackToList} />
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
