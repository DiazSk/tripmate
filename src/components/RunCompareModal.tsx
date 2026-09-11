"use client";

import { useEffect, useState } from "react";
import { diffWords } from "diff";
import { X } from "lucide-react";
import { compareRuns, extractResultText } from "@/lib/compareRuns";
import { RunComparisonRole, RunDetail, RunSummary } from "@/lib/types";

const ROLE_LABELS: Record<RunComparisonRole["role"], string> = {
  context: "Context Retrieval",
  generation: "Generation",
  critique: "Critique/Validation",
};

const KIND_LABELS: Record<string, string> = {
  generate: "Generate",
  refine: "Refine",
  rebalance: "Rebalance",
  "place-detail": "Place Detail",
};

function formatMs(ms: number): string {
  const abs = Math.abs(ms);
  return abs < 1000 ? `${Math.round(abs)}ms` : `${(abs / 1000).toFixed(1)}s`;
}

function formatDurationDelta(deltaMs: number | null): string {
  if (deltaMs == null) return "—";
  if (deltaMs === 0) return "±0ms";
  return deltaMs > 0 ? `+${formatMs(deltaMs)} slower` : `-${formatMs(deltaMs)} faster`;
}

function formatTokenDelta(delta: number | null): string {
  if (delta == null) return "—";
  if (delta === 0) return "±0 tok";
  return delta > 0 ? `+${delta} tok` : `${delta} tok`;
}

function WordDiff({ before, after }: { before: string; after: string }) {
  if (!before && !after) return <p className="text-xs text-muted">Nothing to diff.</p>;
  const parts = diffWords(before, after);
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-card-border bg-tile p-3 text-xs text-foreground">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            // Diff highlights, tinted on dark like the badges. These were `-100` fills with
            // `-800` text — a light-mode diff, invisible once the panel stopped being white.
            part.added
              ? "bg-accent/20 text-accent"
              : part.removed
                ? "bg-alert-soft text-alert line-through"
                : ""
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

function RoleCard({ role }: { role: RunComparisonRole }) {
  if (!role.stepA && !role.stepB) return null;
  return (
    <div className="rounded-xl border border-card-border bg-surface-deep p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{ROLE_LABELS[role.role]}</span>
        <span className="text-xs font-medium text-muted">
          {formatDurationDelta(role.durationDeltaMs)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
        <span>In: {formatTokenDelta(role.inputTokenDelta)}</span>
        <span>Out: {formatTokenDelta(role.outputTokenDelta)}</span>
      </div>
      {role.stepA && role.stepB && (
        <div className="mt-2 space-y-2">
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted">
              Prompt diff
            </summary>
            <div className="mt-1.5">
              <WordDiff before={role.stepA.prompt} after={role.stepB.prompt} />
            </div>
          </details>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted">
              Response diff
            </summary>
            <div className="mt-1.5">
              <WordDiff
                before={extractResultText(role.stepA.rawResponse)}
                after={extractResultText(role.stepB.rawResponse)}
              />
            </div>
          </details>
        </div>
      )}
      {(!role.stepA || !role.stepB) && (
        <p className="mt-1.5 text-xs text-muted">Only present in one run — nothing to diff.</p>
      )}
    </div>
  );
}

function RunMetaCard({ run, label }: { run: RunDetail; label: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-tile p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-medium text-foreground">{run.destination}</div>
      <div className="mt-1 text-xs text-muted">
        {KIND_LABELS[run.kind] ?? run.kind} · {new Date(run.createdAt).toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-muted">
        {formatMs(run.totalDurationMs)} total · {run.stepCount} step
        {run.stepCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

export default function RunCompareModal({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const [baseRun, setBaseRun] = useState<RunDetail | null>(null);
  const [candidates, setCandidates] = useState<RunSummary[]>([]);
  const [candidateRun, setCandidateRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCandidate, setLoadingCandidate] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/llm-traces/runs/${runId}`).then((res) => res.json()),
      fetch("/api/llm-traces/runs").then((res) => res.json()),
    ])
      .then(([runData, listData]) => {
        if (runData.error) throw new Error(runData.error);
        setBaseRun(runData);
        const others: RunSummary[] = (listData.runs ?? []).filter(
          (r: RunSummary) => r.id !== runId && r.destination === runData.destination
        );
        setCandidates(others);
      })
      .catch((e) => setError(e.message));
  }, [runId]);

  function selectCandidate(id: string) {
    setLoadingCandidate(true);
    setError(null);
    fetch(`/api/llm-traces/runs/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load run");
        setCandidateRun(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingCandidate(false));
  }

  const [older, newer] =
    baseRun && candidateRun
      ? new Date(baseRun.createdAt) <= new Date(candidateRun.createdAt)
        ? [baseRun, candidateRun]
        : [candidateRun, baseRun]
      : [null, null];

  const comparison = older && newer ? compareRuns(older, newer) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-deep shadow-2xl">
        <div className="flex items-center justify-between border-b border-card-border px-5 py-3">
          <div className="text-sm font-semibold text-foreground">Compare pipeline runs</div>
          <button
            onClick={onClose}
            aria-label="Close comparison"
            title="Close"
            className="rounded-md p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded-lg border border-alert/30 bg-alert-soft p-3 text-sm text-alert">
              {error}
            </div>
          )}
          {!baseRun && !error && <p className="text-sm text-muted">Loading…</p>}

          {baseRun && !candidateRun && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Pick a previous run for <span className="font-medium">{baseRun.destination}</span> to
                compare against:
              </p>
              {candidates.length === 0 && (
                <p className="text-sm text-muted">
                  No other runs for this destination yet.
                </p>
              )}
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCandidate(c.id)}
                    disabled={loadingCandidate}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-card-border bg-surface-deep p-2.5 text-left text-sm shadow-sm transition-colors hover:border-accent/50 hover:bg-accent/10 disabled:opacity-50"
                  >
                    <span className="font-medium text-foreground">
                      {KIND_LABELS[c.kind] ?? c.kind}
                    </span>
                    <span className="text-xs text-muted">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {comparison && older && newer && (
            <div className="space-y-4">
              <button
                onClick={() => setCandidateRun(null)}
                className="text-xs font-medium text-muted hover:text-foreground"
              >
                ← Choose a different run
              </button>
              <div className="grid grid-cols-2 gap-3">
                <RunMetaCard run={older} label="Previous" />
                <RunMetaCard run={newer} label="Current" />
              </div>
              <div className="rounded-xl border border-card-border bg-tile p-3 text-sm">
                <span className="font-medium text-foreground">Total duration: </span>
                {formatDurationDelta(comparison.totalDurationDeltaMs)}
                <span className="ml-3 text-muted">
                  Place-detail steps: {comparison.placeDetailCountA} → {comparison.placeDetailCountB}
                </span>
              </div>
              <div className="space-y-2">
                {comparison.roles.map((role) => (
                  <RoleCard key={role.role} role={role} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
