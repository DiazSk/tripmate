import { MODEL } from "./claude";
import { listGroupedTraces, listRuns, RunRow, TraceRow } from "./db";
import { RunDetail, RunStatus, RunStep, RunStepUsage, RunSummary } from "./types";

/** Token counts/cost are never stored in their own columns — the Claude CLI's
 *  JSON envelope (already saved verbatim as `raw_response`) carries them, so
 *  this just picks them back out on read. `modelUsage.<model>` is the
 *  cumulative per-model count; the top-level `usage.input_tokens` field only
 *  reflects the last turn and reads misleadingly small. */
function parseUsage(rawResponse: string | null): RunStepUsage {
  if (!rawResponse) return { inputTokens: null, outputTokens: null, costUsd: null };
  try {
    const envelope = JSON.parse(rawResponse);
    const modelUsage = envelope.modelUsage?.[MODEL];
    return {
      inputTokens: typeof modelUsage?.inputTokens === "number" ? modelUsage.inputTokens : null,
      outputTokens: typeof modelUsage?.outputTokens === "number" ? modelUsage.outputTokens : null,
      costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
    };
  } catch {
    return { inputTokens: null, outputTokens: null, costUsd: null };
  }
}

export function toRunStep(trace: TraceRow): RunStep {
  return {
    id: trace.id,
    type: trace.type,
    status: trace.status,
    model: trace.model,
    durationMs: trace.duration_ms,
    createdAt: trace.created_at,
    prompt: trace.prompt,
    rawResponse: trace.raw_response,
    errorMessage: trace.error_message,
    usage: parseUsage(trace.raw_response),
  };
}

/** The primary step is the one whose `type` matches the run's own `kind`
 *  (generate/refine/rebalance/place-detail) — every other step (context,
 *  critique, extra place-detail appends) is secondary. */
function computeStatus(kind: string, steps: TraceRow[]): RunStatus {
  const primary = steps.find((s) => s.type === kind);
  if (!primary || primary.status === "pending") return "pending";
  if (primary.status !== "ok") return "failed";
  const secondaryFailed = steps.some((s) => s !== primary && s.status !== "ok");
  return secondaryFailed ? "partial_failure" : "success";
}

export function toRunSummary(run: RunRow, steps: TraceRow[]): RunSummary {
  return {
    id: run.id,
    kind: run.kind,
    destination: run.destination,
    tripId: run.trip_id,
    status: computeStatus(run.kind, steps),
    totalDurationMs: steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    stepCount: steps.length,
    stepTypes: steps.map((s) => s.type),
    createdAt: run.created_at,
  };
}

export function toRunDetail(run: RunRow, steps: TraceRow[]): RunDetail {
  return { ...toRunSummary(run, steps), steps: steps.map(toRunStep) };
}

/** Every run with its computed status/duration, grouping all grouped traces by `run_id` in one
 *  pass — the same shape `/api/llm-traces/runs` builds for the FAB's run list, factored out so
 *  the analytics dashboard (run counts, success rate, per-status breakdown) reads off the exact
 *  same status computation rather than a second, potentially-drifting copy of it. */
export function computeAllRunSummaries(): RunSummary[] {
  const runs = listRuns();
  const stepsByRun = new Map<string, TraceRow[]>();
  for (const trace of listGroupedTraces()) {
    if (!trace.run_id) continue;
    const steps = stepsByRun.get(trace.run_id) ?? [];
    steps.push(trace);
    stepsByRun.set(trace.run_id, steps);
  }
  return runs.map((run) => toRunSummary(run, stepsByRun.get(run.id) ?? []));
}
