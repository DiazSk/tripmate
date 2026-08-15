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
  if (!before && !after) return <p className="text-xs text-stone-400">Nothing to diff.</p>;
  const parts = diffWords(before, after);
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-800">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? "bg-green-100 text-green-800"
              : part.removed
                ? "bg-red-100 text-red-700 line-through"
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
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-stone-900">{ROLE_LABELS[role.role]}</span>
        <span className="text-xs font-medium text-stone-500">
          {formatDurationDelta(role.durationDeltaMs)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-stone-500">
        <span>In: {formatTokenDelta(role.inputTokenDelta)}</span>
        <span>Out: {formatTokenDelta(role.outputTokenDelta)}</span>
      </div>
      {role.stepA && role.stepB && (
        <div className="mt-2 space-y-2">
          <details>
            <summary className="cursor-pointer text-xs font-medium text-stone-600">
              Prompt diff
            </summary>
            <div className="mt-1.5">
              <WordDiff before={role.stepA.prompt} after={role.stepB.prompt} />
            </div>
          </details>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-stone-600">
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
        <p className="mt-1.5 text-xs text-stone-400">Only present in one run — nothing to diff.</p>
      )}
    </div>
  );
}

function RunMetaCard({ run, label }: { run: RunDetail; label: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-0.5 font-medium text-stone-900">{run.destination}</div>
      <div className="mt-1 text-xs text-stone-500">
        {KIND_LABELS[run.kind] ?? run.kind} · {new Date(run.createdAt).toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-stone-500">
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
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
          <div className="text-sm font-semibold text-stone-900">Compare pipeline runs</div>
          <button
            onClick={onClose}
            aria-label="Close comparison"
            title="Close"
            className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {!baseRun && !error && <p className="text-sm text-stone-500">Loading…</p>}

          {baseRun && !candidateRun && (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">
                Pick a previous run for <span className="font-medium">{baseRun.destination}</span> to
                compare against:
              </p>
              {candidates.length === 0 && (
                <p className="text-sm text-stone-500">
                  No other runs for this destination yet.
                </p>
              )}
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCandidate(c.id)}
                    disabled={loadingCandidate}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-2.5 text-left text-sm shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50 disabled:opacity-50"
                  >
                    <span className="font-medium text-stone-800">
                      {KIND_LABELS[c.kind] ?? c.kind}
                    </span>
                    <span className="text-xs text-stone-500">
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
                className="text-xs font-medium text-stone-500 hover:text-stone-800"
              >
                ← Choose a different run
              </button>
              <div className="grid grid-cols-2 gap-3">
                <RunMetaCard run={older} label="Previous" />
                <RunMetaCard run={newer} label="Current" />
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
                <span className="font-medium text-stone-900">Total duration: </span>
                {formatDurationDelta(comparison.totalDurationDeltaMs)}
                <span className="ml-3 text-stone-500">
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
