"use client";

import { useEffect, useState } from "react";
import { diffWords } from "diff";
import { compareRuns, extractResultText } from "@/lib/compareRuns";
import { RunComparisonRole, RunDetail, RunSummary } from "@/lib/types";
import { KIND_LABELS } from "@/lib/runLabels";
import { devLabel } from "@/lib/devInspector";

const ROLE_LABELS: Record<RunComparisonRole["role"], string> = {
  context: "Context Retrieval",
  generation: "Generation",
  critique: "Critique/Validation",
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
    <pre className="max-h-64 overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs whitespace-pre-wrap text-stone-800">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? "bg-green-100 text-green-800"
              : part.removed
                ? "text-red-700 line-through bg-red-100"
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
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-stone-600">Prompt diff</div>
            <WordDiff before={role.stepA.prompt} after={role.stepB.prompt} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-stone-600">Response diff</div>
            <WordDiff
              before={extractResultText(role.stepA.rawResponse)}
              after={extractResultText(role.stepB.rawResponse)}
            />
          </div>
        </div>
      )}
      {(!role.stepA || !role.stepB) && (
        <p className="mt-1.5 text-xs text-stone-400">Only present in one run — nothing to diff.</p>
      )}
    </div>
  );
}

function RunPicker({
  label,
  runs,
  value,
  onChange,
}: {
  label: string;
  runs: RunSummary[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm text-stone-800 focus:border-blue-300 focus:outline-none"
      >
        <option value="">Choose a run…</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.destination} · {KIND_LABELS[r.kind] ?? r.kind} ·{" "}
            {new Date(r.createdAt).toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function RunMetaCard({ run, label }: { run: RunDetail; label: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
      <div className="text-xs font-medium tracking-wide text-stone-400 uppercase">{label}</div>
      <div className="mt-0.5 font-medium text-stone-900">{run.destination}</div>
      <div className="mt-1 text-xs text-stone-500">
        {KIND_LABELS[run.kind] ?? run.kind} · {new Date(run.createdAt).toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-stone-500">
        {formatMs(run.totalDurationMs)} total · {run.stepCount} step{run.stepCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/**
 * Compares any two runs — not just two runs for the same destination like the FAB's
 * `RunCompareModal` restricts to. A dev tool built for "make the backend stronger" benefits from
 * the more powerful, unrestricted version: e.g. comparing a "generate" run against a "refine" run
 * for a *different* city still tells you something about prompt-length or duration trends.
 */
export default function CompareRuns({ initialRunIdA }: { initialRunIdA?: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runIdA, setRunIdA] = useState(initialRunIdA ?? "");
  const [runIdB, setRunIdB] = useState("");
  const [runA, setRunA] = useState<RunDetail | null>(null);
  const [runB, setRunB] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/llm-traces/runs")
      .then((res) => res.json())
      .then((data) => setRuns(data.runs ?? []))
      .catch(() => {});
  }, []);

  // No effect syncing `initialRunIdA` back into state: it only ever seeds the initial
  // selection (via useState's initializer above) when a "Compare" button opens this component
  // fresh — the call site remounts with `key={runId}` for a new seed rather than this reacting
  // to prop changes after the fact.

  useEffect(() => {
    if (!runIdA) return; // Rendered as null below via `displayedRunA` — nothing to fetch.
    fetch(`/api/llm-traces/runs/${runIdA}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load run");
        setRunA(data);
      })
      .catch((e) => setError(e.message));
  }, [runIdA]);

  useEffect(() => {
    if (!runIdB) return;
    fetch(`/api/llm-traces/runs/${runIdB}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load run");
        setRunB(data);
      })
      .catch((e) => setError(e.message));
  }, [runIdB]);

  // Derived rather than cleared inside the effects above: picking runId back to "" should hide
  // the stale run immediately without a setState call at the top of an effect body.
  const displayedRunA = runIdA ? runA : null;
  const displayedRunB = runIdB ? runB : null;

  const [older, newer] =
    displayedRunA && displayedRunB
      ? new Date(displayedRunA.createdAt) <= new Date(displayedRunB.createdAt)
        ? [displayedRunA, displayedRunB]
        : [displayedRunB, displayedRunA]
      : [null, null];
  const comparison = older && newer ? compareRuns(older, newer) : null;

  return (
    <section className="space-y-3" {...devLabel("CompareRuns")}>
      <h2 className="text-base font-semibold text-stone-900">Compare two runs</h2>

      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row">
        <RunPicker label="Run A" runs={runs} value={runIdA} onChange={setRunIdA} />
        <RunPicker label="Run B" runs={runs} value={runIdB} onChange={setRunIdB} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {!comparison && (runIdA || runIdB) && (
        <p className="text-sm text-stone-500">Pick a second run to see the comparison.</p>
      )}

      {comparison && older && newer && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RunMetaCard run={older} label="Earlier" />
            <RunMetaCard run={newer} label="Later" />
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
    </section>
  );
}
