"use client";

import { useEffect, useState } from "react";
import { FeaturePerfStats } from "@/lib/types";
import { formatMs, STEP_LABELS } from "@/lib/runLabels";
import { devLabel } from "@/lib/devInspector";

const ALL_TIME = "";

function fmtTokens(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}`;
}

function fmtCost(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}

function MetricCell({
  a,
  b,
  format,
}: {
  a: number | null;
  b: number | null;
  format: (n: number | null) => string;
}) {
  if (a == null && b == null) return <span className="text-stone-400">—</span>;
  const delta = a != null && b != null && a !== 0 ? ((b - a) / a) * 100 : null;
  return (
    <span className="text-stone-700">
      {format(a)} → {format(b)}
      {delta != null && (
        <span className={delta <= 0 ? "ml-1 text-green-600" : "ml-1 text-red-600"}>
          ({delta > 0 ? "+" : ""}
          {delta.toFixed(0)}%)
        </span>
      )}
    </span>
  );
}

function BatchPicker({
  label,
  tags,
  value,
  onChange,
}: {
  label: string;
  tags: string[];
  value: string;
  onChange: (tag: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm text-stone-800 focus:border-blue-300 focus:outline-none"
      >
        <option value={ALL_TIME}>All time</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
    </label>
  );
}

async function fetchFeatures(batchTag: string): Promise<FeaturePerfStats[]> {
  const query = batchTag ? `?batchTag=${encodeURIComponent(batchTag)}` : "";
  const res = await fetch(`/api/llm-traces/perf${query}`);
  const data = await res.json();
  return data.features ?? [];
}

/**
 * Compares average/median/p95 response time, CLI-awake time, thinking (TTFT), tokens, and
 * cost for each LLM-backed feature type across two selectable batches — "All time" (organic
 * usage) or any label `scripts/perf-bench.mjs` has tagged. A dev tool for judging whether a
 * prompt/model/effort change actually moved the needle, not a production analytics surface.
 */
export default function PerfDashboard() {
  const [tags, setTags] = useState<string[]>([]);
  const [batchTagA, setBatchTagA] = useState(ALL_TIME);
  const [batchTagB, setBatchTagB] = useState(ALL_TIME);
  const [featuresA, setFeaturesA] = useState<FeaturePerfStats[]>([]);
  const [featuresB, setFeaturesB] = useState<FeaturePerfStats[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/llm-traces/perf/tags")
      .then((res) => res.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchFeatures(batchTagA).then(setFeaturesA).catch((e) => setError(e.message));
  }, [batchTagA]);

  useEffect(() => {
    fetchFeatures(batchTagB).then(setFeaturesB).catch((e) => setError(e.message));
  }, [batchTagB]);

  const allTypes = Array.from(
    new Set([...featuresA.map((f) => f.type), ...featuresB.map((f) => f.type)])
  ).sort();

  return (
    <section className="space-y-3" {...devLabel("PerfDashboard")}>
      <h2 className="text-base font-semibold text-stone-900">Perf Dashboard</h2>

      <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row">
        <BatchPicker label="Batch A" tags={tags} value={batchTagA} onChange={setBatchTagA} />
        <BatchPicker label="Batch B" tags={tags} value={batchTagB} onChange={setBatchTagB} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {allTypes.length === 0 && !error && (
        <p className="text-sm text-stone-500">No successful traces yet for either batch.</p>
      )}

      {allTypes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-medium text-stone-500">
                <th className="px-3 py-2">Feature</th>
                <th className="px-3 py-2">Count (A → B)</th>
                <th className="px-3 py-2">Avg Duration</th>
                <th className="px-3 py-2">Avg API Duration</th>
                <th className="px-3 py-2">Avg CLI-Awake</th>
                <th className="px-3 py-2">Avg Thinking (TTFT)</th>
                <th className="px-3 py-2">Avg Tokens In</th>
                <th className="px-3 py-2">Avg Tokens Out</th>
                <th className="px-3 py-2">Avg Cost</th>
              </tr>
            </thead>
            <tbody>
              {allTypes.map((type) => {
                const a = featuresA.find((f) => f.type === type) ?? null;
                const b = featuresB.find((f) => f.type === type) ?? null;
                return (
                  <tr key={type} className="border-t border-stone-100">
                    <td className="px-3 py-2 font-medium text-stone-900">
                      {STEP_LABELS[type] ?? type}
                    </td>
                    <td className="px-3 py-2 text-stone-500">
                      {a?.count ?? 0} → {b?.count ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell a={a?.durationMs.avg ?? null} b={b?.durationMs.avg ?? null} format={formatMs} />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.apiDurationMs.avg ?? null}
                        b={b?.apiDurationMs.avg ?? null}
                        format={formatMs}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.timeToRequestMs.avg ?? null}
                        b={b?.timeToRequestMs.avg ?? null}
                        format={formatMs}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell a={a?.ttftMs.avg ?? null} b={b?.ttftMs.avg ?? null} format={formatMs} />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.inputTokens.avg ?? null}
                        b={b?.inputTokens.avg ?? null}
                        format={fmtTokens}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell
                        a={a?.outputTokens.avg ?? null}
                        b={b?.outputTokens.avg ?? null}
                        format={fmtTokens}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MetricCell a={a?.costUsd.avg ?? null} b={b?.costUsd.avg ?? null} format={fmtCost} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
