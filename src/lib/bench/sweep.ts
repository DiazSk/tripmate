import type { DayWeather } from "../weather";
import type { BenchFixture } from "./fixtures";
import type { BenchCellScores } from "./types";

/**
 * The fixture, but with the weather the model was actually given.
 *
 * The legacy path fetches its own live forecast; the frozen fixture holds a different one.
 * Scoring against the frozen copy would judge the plan on facts it never received.
 */
export function withSeenWeather(fixture: BenchFixture, days: DayWeather[]): BenchFixture {
  const rawFetch = fixture.reconciled.rawFetch;
  return {
    ...fixture,
    reconciled: {
      ...fixture.reconciled,
      rawFetch: {
        ...rawFetch,
        weather: { available: days.length > 0, historical: days.some((d) => d.historical), days },
      },
    },
  };
}

/**
 * Grounding scores only claims that contradict the context — invented hours for an anchor whose
 * hours were unknown, a travel time for an anchor pair with no leg. The legacy path is never given
 * that context (no candidate list, no anchor legs), so its grounding is near-vacuously 1.0: not
 * biased low, just unearned, and it would lift the composite for nothing. Unmeasured,
 * `compositeScore` renormalises over the groups that remain. The raw number is still reported.
 */
export function withoutGrounding(scores: BenchCellScores): BenchCellScores {
  return { ...scores, grounding: { ...scores.grounding, normalized: null } };
}

/** An arm cell's runs. Files written before `AB_RUNS` hold one run inline, as the cell itself. */
export function runsOf<T extends object>(cell: T & { runs?: T[] }): T[] {
  return cell.runs ?? [cell];
}

export interface ScoredRun {
  failed: boolean;
  composite: number | null;
  critical: string[];
  costUsd: number;
  wallMs: number;
}

export interface RunSummary {
  n: number;
  meanComposite: number | null;
  worstComposite: number | null;
  criticalRuns: number;
  codes: string[];
  meanCostUsd: number;
  meanWallMs: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Per-fixture view: the mean hides the bad run, so the worst run and the failure count sit beside it. */
export function summarizeRuns(runs: ScoredRun[]): RunSummary {
  const composites = runs.map((r) => r.composite).filter((c): c is number => c !== null);
  return {
    n: runs.length,
    meanComposite: composites.length ? mean(composites) : null,
    worstComposite: composites.length ? Math.min(...composites) : null,
    criticalRuns: runs.filter((r) => r.critical.length > 0).length,
    codes: [...new Set(runs.flatMap((r) => r.critical))].sort(),
    meanCostUsd: mean(runs.map((r) => r.costUsd)),
    meanWallMs: mean(runs.map((r) => r.wallMs)),
  };
}

/** The headline: runs with at least one hard failure, over all runs. */
export function criticalRate(runs: ScoredRun[]): { failing: number; total: number; rate: number | null } {
  const failing = runs.filter((r) => r.critical.length > 0).length;
  return { failing, total: runs.length, rate: runs.length ? failing / runs.length : null };
}

/**
 * A readable reason for a failed run. `ECONNREFUSED` over `node:http` arrives as an
 * AggregateError whose `message` is "" — and an empty reason once let a dead server's run be
 * stored as falsy `error: ""`, then counted and scored as a success.
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return err.message || (typeof code === "string" ? code : "") || err.name || "unknown error";
  }
  return String(err) || "unknown error";
}

/** Failed means no plan came back — decided by the missing plan, not by the error's wording. */
export function isFailedRun(run: { error?: string; itineraryMd?: string | null; itineraryJson?: unknown }): boolean {
  return run.error !== undefined || (!run.itineraryMd && !run.itineraryJson);
}

/**
 * Headline delta between two arms, and whether it compares like with like. `travel_leg` needs typed
 * stops, so it runs on legacy JSON only — a staged arm is gated on one rule fewer, and a
 * staged-vs-legacy delta is biased against legacy.
 */
export function headlineDelta(
  a: { rate: number | null },
  b: { rate: number | null },
  pathA: string,
  pathB: string
): { delta: number | null; likeForLike: boolean } {
  return { delta: a.rate !== null && b.rate !== null ? b.rate - a.rate : null, likeForLike: pathA === pathB };
}
