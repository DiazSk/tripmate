"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, GitCompare, Terminal, X } from "lucide-react";
import TraceStatusBadge from "@/components/TraceStatusBadge";
import TransportBadge from "@/components/TransportBadge";
import RunCompareModal from "@/components/RunCompareModal";
import RunPipelineDiagram from "@/components/RunPipelineDiagram";
import { RunDetail, RunStep, RunSummary, TraceSummary } from "@/lib/types";
import { KIND_LABELS, STEP_LABELS, formatMs } from "@/lib/runLabels";

type View = "list" | "run" | "legacy";

interface LlmTraceWidgetApi {
  openList: () => void;
  openRun: (runId: string) => void;
  close: () => void;
}

const LlmTraceWidgetContext = createContext<LlmTraceWidgetApi | null>(null);

/** Lets any "View LLM pipeline for this call →" link open the FAB panel
 *  pre-focused on that run, instead of navigating to a page that no longer
 *  exists — see .claude/skills/dev-analytics-fab/SKILL.md. */
export function useLlmTraceWidget(): LlmTraceWidgetApi {
  const ctx = useContext(LlmTraceWidgetContext);
  if (!ctx) throw new Error("useLlmTraceWidget must be used within <LlmTraceFabProvider>");
  return ctx;
}

const RUN_STATUS_STYLES: Record<string, string> = {
  success: "bg-accent/15 text-accent border-accent/30",
  partial_failure: "bg-alert-soft text-alert/75 border-alert/30",
  failed: "bg-alert-soft text-alert border-alert/30",
  pending: "bg-tile text-muted border-card-border",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  success: "Success",
  partial_failure: "Partial Failure",
  failed: "Failed",
  pending: "Pending",
};

function RunStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
        RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.pending
      }`}
    >
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function LlmTraceFabProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);

  const openList = useCallback(() => {
    setView("list");
    setSelectedRunId(null);
    setSelectedTraceId(null);
    setIsOpen(true);
  }, []);

  const openRun = useCallback((runId: string) => {
    setView("run");
    setSelectedRunId(runId);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <LlmTraceWidgetContext.Provider value={{ openList, openRun, close }}>
      {children}
      <LlmTraceFab
        isOpen={isOpen}
        view={view}
        selectedRunId={selectedRunId}
        selectedTraceId={selectedTraceId}
        onOpen={openList}
        onClose={close}
        onSelectRun={(id) => {
          setView("run");
          setSelectedRunId(id);
        }}
        onSelectLegacy={(id) => {
          setView("legacy");
          setSelectedTraceId(id);
        }}
        onBackToList={() => {
          setView("list");
          setSelectedRunId(null);
          setSelectedTraceId(null);
        }}
        onCompare={setCompareRunId}
      />
      {compareRunId && (
        <RunCompareModal runId={compareRunId} onClose={() => setCompareRunId(null)} />
      )}
    </LlmTraceWidgetContext.Provider>
  );
}

function RunList({
  onSelectRun,
  onSelectLegacy,
}: {
  onSelectRun: (id: string) => void;
  onSelectLegacy: (id: string) => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [ungroupedTraces, setUngroupedTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/llm-traces/runs")
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs ?? []);
        setUngroupedTraces(data.ungroupedTraces ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-4 text-sm text-muted">Loading…</p>;
  if (runs.length === 0 && ungroupedTraces.length === 0)
    return <p className="p-4 text-sm text-muted">No calls logged yet.</p>;

  return (
    <div className="space-y-2 overflow-y-auto p-3">
      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => onSelectRun(run.id)}
          className="flex w-full flex-col gap-1.5 rounded-xl border border-card-border bg-surface-deep p-3 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-accent/10"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{run.destination}</div>
              <div className="text-xs text-muted">{KIND_LABELS[run.kind] ?? run.kind}</div>
            </div>
            <RunStatusBadge status={run.status} />
          </div>
          <div className="truncate text-xs text-muted">
            {run.stepTypes.map((t) => STEP_LABELS[t] ?? t).join(" ➔ ")}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{new Date(run.createdAt).toLocaleString()}</span>
            <span>·</span>
            <span>{formatMs(run.totalDurationMs)} total</span>
            <span>·</span>
            <span>
              {run.stepCount} step{run.stepCount === 1 ? "" : "s"}
            </span>
          </div>
        </button>
      ))}

      {ungroupedTraces.length > 0 && (
        <>
          <div className="pt-2 text-xs font-medium uppercase tracking-wide text-muted">
            Ungrouped (legacy)
          </div>
          {ungroupedTraces.map((trace) => (
            <button
              key={trace.id}
              onClick={() => onSelectLegacy(trace.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-card-border bg-surface-deep p-3 text-left shadow-sm transition-colors hover:border-accent/50 hover:bg-accent/10"
            >
              <div className="min-w-0">
                <div className="font-medium capitalize text-foreground">{trace.type}</div>
                <div className="truncate text-xs text-muted">
                  {new Date(trace.createdAt).toLocaleString()}
                  {trace.durationMs != null && ` · ${trace.durationMs}ms`}
                </div>
              </div>
              <TraceStatusBadge status={trace.status} />
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function StepDetail({ step, onBack }: { step: RunStep; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <button
        onClick={onBack}
        className="mb-2 flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to pipeline
      </button>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-medium text-foreground">{STEP_LABELS[step.type] ?? step.type}</span>
          <span>·</span>
          <span>{step.model}</span>
          <span>·</span>
          <span>{new Date(step.createdAt).toLocaleString()}</span>
          <span>·</span>
          <span>{formatMs(step.durationMs)}</span>
          <TraceStatusBadge status={step.status} />
          <TransportBadge transport={step.usage.transport} />
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span>In: {step.usage.inputTokens ?? "—"} tok</span>
          <span>Out: {step.usage.outputTokens ?? "—"} tok</span>
          <span>Cost: {step.usage.costUsd != null ? `$${step.usage.costUsd.toFixed(4)}` : "—"}</span>
        </div>

        {step.errorMessage && (
          <div className="rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm text-alert">
            {step.errorMessage}
          </div>
        )}

        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-tile-foreground">Prompt sent to Claude</h3>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border bg-tile p-3 text-xs text-foreground">
            {step.prompt}
          </pre>
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-tile-foreground">Raw response</h3>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border bg-tile p-3 text-xs text-foreground">
            {step.rawResponse ?? "(no response captured)"}
          </pre>
        </div>
      </div>
    </div>
  );
}

// Keyed by `runId` at the call site so switching runs remounts this fresh —
// simpler and lint-clean than resetting fetch/selection state by hand inside
// an effect every time `runId` changes.
function RunView({
  runId,
  onBack,
  onCompare,
}: {
  runId: string;
  onBack: () => void;
  onCompare: (runId: string) => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<RunStep | null>(null);

  useEffect(() => {
    fetch(`/api/llm-traces/runs/${runId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load run");
        setRun(data);
      })
      .catch((e) => setError(e.message));
  }, [runId]);

  if (selectedStep) {
    return <StepDetail step={selectedStep} onBack={() => setSelectedStep(null)} />;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <button
        onClick={onBack}
        className="mb-2 flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to list
      </button>

      {error && (
        <div className="rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm text-alert">{error}</div>
      )}
      {!run && !error && <p className="text-sm text-muted">Loading…</p>}

      {run && (
        <div className="space-y-3">
          <div className="rounded-xl border border-card-border bg-tile p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-foreground">{run.destination}</div>
              <RunStatusBadge status={run.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{KIND_LABELS[run.kind] ?? run.kind}</span>
              <span>·</span>
              <span>{new Date(run.createdAt).toLocaleString()}</span>
              <span>·</span>
              <span>{formatMs(run.totalDurationMs)} total</span>
            </div>
            <button
              onClick={() => onCompare(run.id)}
              className="mt-2 flex items-center gap-1.5 rounded-full border border-white/20 bg-surface-deep px-2.5 py-1 text-xs font-medium text-tile-foreground transition-colors hover:border-accent/50 hover:bg-accent/10"
            >
              <GitCompare className="h-3 w-3" /> Compare with previous run
            </button>
          </div>

          <RunPipelineDiagram kind={run.kind} steps={run.steps} onSelectStep={setSelectedStep} />
        </div>
      )}
    </div>
  );
}

// Same fetch-by-id detail view the flat trace list used before pipeline
// grouping existed — kept only for rows with no `run_id` (pre-migration).
function LegacyDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [trace, setTrace] = useState<{
    type: string;
    status: string;
    model: string;
    durationMs: number | null;
    createdAt: string;
    prompt: string;
    rawResponse: string | null;
    errorMessage: string | null;
  } | null>(null);
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
        className="mb-2 flex items-center gap-1.5 self-start text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to list
      </button>

      {error && (
        <div className="rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm text-alert">{error}</div>
      )}
      {!trace && !error && <p className="text-sm text-muted">Loading…</p>}

      {trace && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-medium capitalize text-foreground">{trace.type}</span>
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
            <div className="rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm text-alert">
              {trace.errorMessage}
            </div>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-tile-foreground">Prompt sent to Claude</h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border bg-tile p-3 text-xs text-foreground">
              {trace.prompt}
            </pre>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-tile-foreground">Raw response</h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border bg-tile p-3 text-xs text-foreground">
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
  selectedRunId,
  selectedTraceId,
  onOpen,
  onClose,
  onSelectRun,
  onSelectLegacy,
  onBackToList,
  onCompare,
}: {
  isOpen: boolean;
  view: View;
  selectedRunId: string | null;
  selectedTraceId: string | null;
  onOpen: () => void;
  onClose: () => void;
  onSelectRun: (id: string) => void;
  onSelectLegacy: (id: string) => void;
  onBackToList: () => void;
  onCompare: (runId: string) => void;
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
            // `print:hidden` because this mounts as a sibling of `.app-shell`, outside the reach
            // of the print block's chrome rule in globals.css. It printed as a black dot.
            //
            // `glass-control` rather than a bespoke fill: this is a floating control over the map
            // canvas exactly like `MapControls`' zoom and compass in the opposite corner, and it
            // was the one that didn't look like them.
            //
            // **Not rendered below `sm` at all**, which is a retreat rather than another offset.
            // This button has now lost the bottom-right corner twice on a phone: first to the old
            // full-width "Plan a trip" bar, which `bottom-24` cleared, and then to the entry
            // capsule that replaced it — a stacked three-cell light pill roughly 430px tall that is
            // the whole point of the first viewport. Raising the offset to `bottom-44` just moved
            // the disc from the capsule's bottom edge to its middle. There is no free corner on a
            // 390px landing, because the landing deliberately fills it.
            //
            // It is a development tool. `dev` is the mode the app is demoed in, which is exactly
            // why a dark disc parked on the one light surface in the system matters — and also why
            // losing it on a phone costs nothing: nobody reads a raw model response at 390px. The
            // desktop position is unchanged and unobstructed.
            className="glass-control fixed right-5 bottom-5 z-50 hidden h-12 w-12 items-center justify-center rounded-full text-foreground transition-transform hover:scale-105 sm:flex print:hidden"
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
            // Width is capped to the viewport because 23rem + the 20px inset is 388px, which
            // overflowed a 390px phone by a hair and clipped the run rows' right edge.
            // Height likewise, so the panel can't run off the top of a short screen.
            className="fixed right-5 bottom-5 z-50 flex h-[min(32rem,calc(100dvh-6rem))] w-[min(23rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-card-border bg-surface-deep shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Terminal className="h-4 w-4 text-muted" />
                LLM pipelines
              </div>
              <button
                onClick={onClose}
                aria-label="Collapse LLM trace viewer"
                title="Collapse"
                className="rounded-md p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {view === "list" && (
                <RunList onSelectRun={onSelectRun} onSelectLegacy={onSelectLegacy} />
              )}
              {view === "run" && selectedRunId && (
                <RunView key={selectedRunId} runId={selectedRunId} onBack={onBackToList} onCompare={onCompare} />
              )}
              {view === "legacy" && selectedTraceId && (
                <LegacyDetail key={selectedTraceId} id={selectedTraceId} onBack={onBackToList} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
