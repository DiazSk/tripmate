import { RunComparison, RunComparisonRole, RunDetail, RunStep } from "./types";

/** The raw CLI envelope is mostly noise for a diff (session_id, timestamps,
 *  usage stats all change every call) — pull out just the model's actual
 *  output text, which is what a "did the output change" diff should compare. */
export function extractResultText(rawResponse: string | null): string {
  if (!rawResponse) return "";
  try {
    const envelope = JSON.parse(rawResponse);
    return typeof envelope.result === "string" ? envelope.result : rawResponse;
  } catch {
    return rawResponse;
  }
}

const GENERATION_TYPES = new Set(["generate", "refine"]);

function findStep(steps: RunStep[], predicate: (step: RunStep) => boolean): RunStep | null {
  return steps.find(predicate) ?? null;
}

function delta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return b - a;
}

function buildRole(role: RunComparisonRole["role"], stepA: RunStep | null, stepB: RunStep | null): RunComparisonRole {
  return {
    role,
    stepA,
    stepB,
    durationDeltaMs: delta(stepA?.durationMs ?? null, stepB?.durationMs ?? null),
    inputTokenDelta: delta(stepA?.usage.inputTokens ?? null, stepB?.usage.inputTokens ?? null),
    outputTokenDelta: delta(stepA?.usage.outputTokens ?? null, stepB?.usage.outputTokens ?? null),
  };
}

/**
 * Pairs two pipeline runs' steps by role — context↔context, the generate/
 * refine step↔"generation" (whichever kind each run actually used), critique
 * ↔critique — and computes per-role deltas. Place-detail steps have no
 * stable identity across two independent runs (different stops, different
 * counts), so they're only counted/summed here, never paired 1:1.
 */
export function compareRuns(a: RunDetail, b: RunDetail): RunComparison {
  const roles: RunComparisonRole[] = [
    buildRole(
      "context",
      findStep(a.steps, (s) => s.type === "context"),
      findStep(b.steps, (s) => s.type === "context")
    ),
    buildRole(
      "generation",
      findStep(a.steps, (s) => GENERATION_TYPES.has(s.type)),
      findStep(b.steps, (s) => GENERATION_TYPES.has(s.type))
    ),
    buildRole(
      "critique",
      findStep(a.steps, (s) => s.type === "critique"),
      findStep(b.steps, (s) => s.type === "critique")
    ),
  ];

  return {
    runA: a,
    runB: b,
    roles,
    placeDetailCountA: a.steps.filter((s) => s.type === "place-detail").length,
    placeDetailCountB: b.steps.filter((s) => s.type === "place-detail").length,
    totalDurationDeltaMs: b.totalDurationMs - a.totalDurationMs,
  };
}
