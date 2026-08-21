import { evaluateItinerary } from "../../guardrails";
import { applyPatch } from "../../itineraryPatch";
import type { PatchOp } from "../../itineraryPatch";
import type { Itinerary } from "../../types";
import type { CompositeGroups, RefineCellScores, RefinePatchScore } from "../types";
import { COMPOSITE_WEIGHTS } from "../types";

export interface ScorePatchArgs {
  base: Itinerary;
  ops: PatchOp[];
  task: { expect: { opsExpected: boolean; allowedDays?: number[] } };
  budget: number;
}

/** Days the applied ops actually landed on, so scope is measured against reality, not intent. */
function touchedDays(ops: PatchOp[], rejected: PatchOp[]): number[] {
  const rejectedSet = new Set(rejected);
  const days = new Set<number>();
  for (const op of ops) {
    if (rejectedSet.has(op)) continue;
    days.add(op.dayIndex);
  }
  return [...days];
}

export function scorePatch(args: ScorePatchArgs): RefinePatchScore {
  const { base, ops, task, budget } = args;
  const { itinerary: after, rejected } = applyPatch(base, ops);

  const guardrailsBefore = evaluateItinerary(base, { budget }).length;
  const guardrailsAfter = evaluateItinerary(after, { budget }).length;
  const guardrailDelta = guardrailsAfter - guardrailsBefore;

  const applied = ops.length === 0 ? null : (ops.length - rejected.length) / ops.length;

  const allowed = task.expect.allowedDays;
  const touched = touchedDays(ops, rejected.map((r) => r.op));
  const scope =
    allowed === undefined || touched.length === 0
      ? null
      : touched.filter((d) => allowed.includes(d)).length / touched.length;

  const restraint = ops.length > 0 === task.expect.opsExpected;

  // Mean of the parts that applied. An unmeasurable part is skipped rather than scored 0 — the same
  // rule compositeGroups() uses, and for the same reason: a test that never ran is not a failure.
  const parts = [
    applied,
    scope,
    restraint ? 1 : 0,
    guardrailDelta <= 0 ? 1 : 0,
  ].filter((p): p is number => p !== null);
  const normalized = parts.length > 0 ? parts.reduce((s, p) => s + p, 0) / parts.length : null;

  return {
    opsEmitted: ops.length,
    opsRejected: rejected.length,
    rejectedReasons: rejected.map((r) => r.reason),
    applied,
    scope,
    restraint,
    guardrailsBefore,
    guardrailsAfter,
    guardrailDelta,
    normalized,
  };
}

/** after − before per weighted group; null wherever either side could not be measured. */
export function deltaGroups(before: CompositeGroups, after: CompositeGroups): CompositeGroups {
  const keys = Object.keys(COMPOSITE_WEIGHTS) as (keyof CompositeGroups)[];
  const out = {} as CompositeGroups;
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    out[key] = b === null || a === null ? null : a - b;
  }
  return out;
}

/**
 * A refine cell's headline number: half "did the trip get worse", half "was the patch well-formed".
 *
 * The delta half is `1 + weighted-mean(delta)` clamped to [0,1], so leaving the plan's quality
 * untouched scores 1.0 and degrading it subtracts. Improvement cannot push past 1.0 — an edit that
 * incidentally raises the trip's score is not evidence the model followed the instruction, and
 * rewarding it would let a model win by rewriting days nobody asked about.
 *
 * The weighting mirrors `compositeScore()` in `runBenchmark.ts`: each measurable group's delta is
 * weighted by `COMPOSITE_WEIGHTS`, then renormalized over the summed weight of the groups that
 * were measurable (not divided by 5 groups regardless of which ones were null). Weighting the
 * absolute score by `coverageGrounding: 0.30` but averaging its delta evenly would let a model's
 * generation and refine composites disagree about which group matters most.
 */
export function refineComposite(scores: RefineCellScores): number | null {
  if (scores.operational.failed) return null;

  const entries = (Object.keys(COMPOSITE_WEIGHTS) as (keyof CompositeGroups)[])
    .map((key) => ({ value: scores.delta[key], weight: COMPOSITE_WEIGHTS[key] }))
    .filter((e): e is { value: number; weight: number } => e.value !== null);
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  const deltaScore =
    entries.length === 0 || totalWeight === 0
      ? null
      : Math.max(0, Math.min(1, 1 + entries.reduce((s, e) => s + e.value * e.weight, 0) / totalWeight));

  const parts = [deltaScore, scores.patch.normalized].filter((p): p is number => p !== null);
  return parts.length > 0 ? parts.reduce((s, p) => s + p, 0) / parts.length : null;
}
