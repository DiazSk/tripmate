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
 * Grounding counts stops missing from the candidate list, and the legacy path is never given one —
 * so for that path it measures the pipeline, not the plan. Unmeasured, `compositeScore`
 * renormalises over the groups that remain. The raw number is still reported beside it.
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
