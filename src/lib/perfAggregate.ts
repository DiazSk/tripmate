import type { FeaturePerfStats, MetricStats } from "./types";

export interface CliMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ttftMs: number | null;
  timeToRequestMs: number | null;
  apiDurationMs: number | null;
}

const EMPTY_METRICS: CliMetrics = {
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  ttftMs: null,
  timeToRequestMs: null,
  apiDurationMs: null,
};

/** Pulls tokens/cost/timing back out of the CLI's raw JSON envelope — the same
 *  envelope `runs.ts`'s `parseUsage` already reads for the trace-viewer UI, but this
 *  additionally surfaces the timing fields (`ttft_ms`, `time_to_request_ms`,
 *  `duration_api_ms`) that only the Perf Dashboard needs, kept in a separate function
 *  so the existing trace-viewer's `RunStepUsage` type/consumers stay untouched. */
export function parseCliMetrics(rawResponse: string | null): CliMetrics {
  if (!rawResponse) return EMPTY_METRICS;
  try {
    const envelope = JSON.parse(rawResponse);
    // Keyed by whichever model actually produced this trace, not a hardcoded
    // constant — a model swap (the exact kind of change this dashboard exists
    // to measure) would otherwise silently blank token stats for every trace
    // recorded under the old model string.
    const modelUsage = Object.values(envelope.modelUsage ?? {})[0] as
      | { inputTokens?: number; outputTokens?: number }
      | undefined;
    return {
      inputTokens: typeof modelUsage?.inputTokens === "number" ? modelUsage.inputTokens : null,
      outputTokens: typeof modelUsage?.outputTokens === "number" ? modelUsage.outputTokens : null,
      costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
      ttftMs: typeof envelope.ttft_ms === "number" ? envelope.ttft_ms : null,
      timeToRequestMs:
        typeof envelope.time_to_request_ms === "number" ? envelope.time_to_request_ms : null,
      apiDurationMs: typeof envelope.duration_api_ms === "number" ? envelope.duration_api_ms : null,
    };
  } catch {
    return EMPTY_METRICS;
  }
}

// ponytail: index-based median/p95 (no interpolation) — simplest thing that
// works for a dev benchmarking tool with dozens-to-low-hundreds of samples.
// Switch to interpolated percentiles if this ever needs to be precise at
// small-n or feed an external metrics system.
function computeStats(values: number[]): MetricStats {
  if (values.length === 0) return { avg: null, median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { avg, median: at(0.5), p95: at(0.95) };
}

function numbersOnly(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v != null);
}

export interface PerfTraceInput {
  type: string;
  durationMs: number | null;
  rawResponse: string | null;
}

/** Groups traces by `type` (generate/critique/rebalance/place-detail/chat/element-edit/
 *  context) and computes avg/median/p95 for wall-clock duration, CLI-awake time,
 *  time-to-first-token, API-side duration, tokens, and cost. Each metric's stats are
 *  computed only from the rows that actually have that field — a step with no cost data
 *  doesn't drag its median toward zero. */
export function aggregatePerfStats(traces: PerfTraceInput[]): FeaturePerfStats[] {
  const byType = new Map<string, PerfTraceInput[]>();
  for (const trace of traces) {
    const rows = byType.get(trace.type) ?? [];
    rows.push(trace);
    byType.set(trace.type, rows);
  }

  const result: FeaturePerfStats[] = [];
  for (const [type, rows] of byType) {
    const metrics = rows.map((r) => parseCliMetrics(r.rawResponse));
    result.push({
      type,
      count: rows.length,
      durationMs: computeStats(numbersOnly(rows.map((r) => r.durationMs))),
      timeToRequestMs: computeStats(numbersOnly(metrics.map((m) => m.timeToRequestMs))),
      ttftMs: computeStats(numbersOnly(metrics.map((m) => m.ttftMs))),
      apiDurationMs: computeStats(numbersOnly(metrics.map((m) => m.apiDurationMs))),
      inputTokens: computeStats(numbersOnly(metrics.map((m) => m.inputTokens))),
      outputTokens: computeStats(numbersOnly(metrics.map((m) => m.outputTokens))),
      costUsd: computeStats(numbersOnly(metrics.map((m) => m.costUsd))),
    });
  }

  return result.sort((a, b) => a.type.localeCompare(b.type));
}
