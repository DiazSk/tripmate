import { getTrace, insertBenchResult } from "../db";
import type { BenchResultRow } from "../db";
import { generateItinerary } from "../generateItinerary";
import { parseUsage } from "../runs";
import type { BenchFixture } from "./fixtures";
import { benchTimeoutMs, computeCostUsd, promptTokens } from "./models";
import { parseItinerary } from "./parseItinerary";
import {
  scoreConstraints,
  scoreCoverage,
  scoreFeasibility,
  scoreFormat,
  scoreGeoCoherence,
  scoreGrounding,
} from "./scorers/domain";
import { scoreBacktrack, scoreDowntime, scoreMealProximity } from "./scorers/route";
import { scoreBudget, scoreVibe, scoreWeatherAlignment } from "./scorers/context";
import { outputSimilarity, scoreLexical, scoreSemantic } from "./scorers/text";
import { COMPOSITE_WEIGHTS, RADAR_AXES } from "./types";
import type {
  BenchCell,
  BenchCellScores,
  CompositeGroups,
  ModelAgreement,
  OperationalScore,
} from "./types";

/**
 * Runs one benchmark cell and scores it.
 *
 * The generation itself is `generateItinerary()` — the exact function `/api/trip-generate` calls,
 * with the exact same skill, the exact same `buildTripContext()` digest and the exact same
 * generation prompt. The ONLY argument that differs between cells for the same fixture is `model`.
 * That is the harness's entire claim to attributing differences to the model, so nothing in this
 * file may reach around it and assemble a prompt of its own.
 */

/** Minimum weighted groups that must be measurable before a composite score means anything. */
const MIN_GROUPS_FOR_COMPOSITE = 3;

/** Mean of the parts that could be measured; null when none could. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return present.length > 0 ? present.reduce((s, v) => s + v, 0) / present.length : null;
}

/**
 * The five weighted groups, each averaged over whichever of its parts this trip could measure.
 *
 * A group goes null rather than 0 when nothing in it applies — a sunny trip has no weather score,
 * and a plan with two stops a day has no route ordering to judge. Scoring those as 0 would punish
 * a model for a test that was never run.
 */
export function compositeGroups(scores: BenchCellScores): CompositeGroups {
  return {
    routeEfficiency: meanOf([scores.geoCoherence.normalized, scores.backtrack.normalized]),
    constraintAdherence: scores.constraints.normalized,
    weatherFeasibility: meanOf([
      scores.weather.normalized,
      scores.feasibility.normalized,
      scores.downtime.normalized,
    ]),
    mealVibeAlignment: meanOf([scores.mealProximity.normalized, scores.vibe.normalized]),
    coverageGrounding: meanOf([scores.coverage.normalized, scores.grounding.normalized]),
  };
}

export function scoreItinerary(
  fixture: BenchFixture,
  itineraryMd: string,
  operational: OperationalScore
): BenchCellScores {
  const parsed = parseItinerary(itineraryMd);
  return {
    geoCoherence: scoreGeoCoherence(parsed, fixture),
    constraints: scoreConstraints(parsed, fixture),
    feasibility: scoreFeasibility(parsed),
    coverage: scoreCoverage(parsed, fixture),
    grounding: scoreGrounding(parsed, fixture),
    format: scoreFormat(parsed, fixture),
    backtrack: scoreBacktrack(parsed, fixture),
    mealProximity: scoreMealProximity(parsed, fixture),
    downtime: scoreDowntime(parsed),
    weather: scoreWeatherAlignment(parsed, fixture),
    budget: scoreBudget(parsed, fixture),
    vibe: scoreVibe(parsed, fixture),
    lexical: scoreLexical(itineraryMd),
    semantic: scoreSemantic(itineraryMd, fixture),
    operational,
    judge: null,
  };
}

/**
 * Weighted composite over the five groups (weights in COMPOSITE_WEIGHTS).
 *
 * Weights are renormalized across the groups that could be measured, so a trip missing one group
 * isn't silently scored out of less than 1.0 — otherwise every sunny trip would cap at 0.85 purely
 * because the weather metric didn't apply.
 */
export function compositeScore(scores: BenchCellScores): number | null {
  const groups = compositeGroups(scores);
  const entries = (Object.keys(COMPOSITE_WEIGHTS) as (keyof CompositeGroups)[])
    .map((key) => ({ key, value: groups[key], weight: COMPOSITE_WEIGHTS[key] }))
    .filter((e): e is { key: keyof CompositeGroups; value: number; weight: number } => e.value !== null);

  if (entries.length < MIN_GROUPS_FOR_COMPOSITE) return null;
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  if (totalWeight === 0) return null;
  return entries.reduce((s, e) => s + e.value * e.weight, 0) / totalWeight;
}

/** The radar now plots the five weighted groups, so the chart and the composite agree. */
export function radarValues(scores: BenchCellScores): Record<string, number | null> {
  return compositeGroups(scores) as unknown as Record<string, number | null>;
}

function failedOperational(latencyMs: number, message: string): OperationalScore {
  return {
    latencyMs,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    cliReportedCostUsd: null,
    parsedOk: false,
    failed: true,
    errorMessage: message,
  };
}

/**
 * One (fixture × model) cell: real generation, then every deterministic scorer, then persistence.
 * A generation failure is recorded as a cell rather than thrown — a model that times out on long
 * trips is a benchmark result, not a crash.
 */
export async function runBenchCell(fixture: BenchFixture, model: string): Promise<BenchCell> {
  const startedAt = Date.now();

  let itineraryMd = "";
  let runId: string | null = null;
  let traceId: string | null = null;
  let operational: OperationalScore;

  try {
    const generated = await generateItinerary({
      reconciled: fixture.reconciled,
      poiDetails: fixture.poiDetails,
      model,
      timeoutMs: benchTimeoutMs(),
    });

    itineraryMd = generated.itineraryMd;
    runId = generated.runId;
    traceId = generated.traceId;

    // Token counts live in the CLI's JSON envelope, already stored verbatim on the trace row —
    // read back through the app's own parser rather than re-implementing envelope parsing here.
    const trace = getTrace(generated.traceId);
    const usage = parseUsage(trace?.raw_response ?? null, model);
    const parsed = parseItinerary(itineraryMd);

    operational = {
      latencyMs: generated.latencyMs,
      // The prompt total, not the uncached remainder — see promptTokens().
      inputTokens: promptTokens(usage),
      outputTokens: usage.outputTokens,
      costUsd: computeCostUsd(model, usage),
      cliReportedCostUsd: usage.costUsd,
      parsedOk: parsed.days.length > 0 && parsed.days.some((d) => Object.values(d.entriesBySlot).some((e) => e.length > 0)),
      failed: false,
      errorMessage: null,
    };
  } catch (err) {
    operational = failedOperational(
      Date.now() - startedAt,
      err instanceof Error ? err.message : "generation failed"
    );
  }

  const scores = scoreItinerary(fixture, itineraryMd, operational);
  const composite = operational.failed ? null : compositeScore(scores);

  const row = insertBenchResult({
    fixture_id: fixture.id,
    model,
    run_id: runId,
    trace_id: traceId,
    itinerary_md: itineraryMd,
    scores_json: JSON.stringify(scores),
    composite,
  });

  return {
    fixtureId: fixture.id,
    model,
    runId,
    traceId,
    itineraryMd,
    scores,
    composite,
    createdAt: row.created_at,
  };
}

export function rowToCell(row: BenchResultRow): BenchCell {
  return {
    fixtureId: row.fixture_id,
    model: row.model,
    runId: row.run_id,
    traceId: row.trace_id,
    itineraryMd: row.itinerary_md,
    scores: JSON.parse(row.scores_json) as BenchCellScores,
    composite: row.composite,
    createdAt: row.created_at,
  };
}

/**
 * model_agreement — pairwise similarity between models' outputs on the same trip. Computed across
 * cells rather than per-cell, since it has no meaning for a single model in isolation.
 */
export function computeModelAgreement(cells: BenchCell[]): ModelAgreement[] {
  const byFixture = new Map<string, BenchCell[]>();
  for (const cell of cells) {
    if (cell.scores.operational.failed) continue;
    const list = byFixture.get(cell.fixtureId) ?? [];
    list.push(cell);
    byFixture.set(cell.fixtureId, list);
  }

  const out: ModelAgreement[] = [];
  for (const [fixtureId, list] of byFixture) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const cosine = outputSimilarity(list[i].itineraryMd, list[j].itineraryMd);
        if (cosine === null) continue;
        out.push({ fixtureId, modelA: list[i].model, modelB: list[j].model, cosine });
      }
    }
  }
  return out;
}

// --- aggregation -------------------------------------------------------------------------------

export interface ModelAggregate {
  model: string;
  cells: number;
  failures: number;
  radar: Record<string, number | null>;
  composite: number | null;
  meanLatencyMs: number | null;
  meanCostUsd: number | null;
  totalCostUsd: number | null;
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  violationsByType: Record<string, number>;
  meanUnlistedRate: number | null;
  meanContradictionRate: number | null;
  meanRelevance: number | null;
  formatPassRate: number;
  /** Individual scorers, kept alongside the weighted groups so the table can show both. */
  meanGeoCoherence: number | null;
  meanCoverage: number | null;
  meanGrounding: number | null;
  meanFeasibility: number | null;
  meanFormat: number | null;
  // --- added metrics -------------------------------------------------------------------------
  meanBacktrack: number | null;
  meanExcessKm: number | null;
  meanMealProximity: number | null;
  mealDetours: number;
  meanDowntime: number | null;
  tightDays: number;
  meanWeatherAlignment: number | null;
  weatherApplicableCells: number;
  meanBudget: number | null;
  overBudgetCells: number;
  meanEstimatedUsd: number | null;
  meanVibe: number | null;
  meanVibeJaccard: number | null;
  meanWords: number | null;
  meanTypeTokenRatio: number | null;
  meanBigramRepetition: number | null;
  meanFleschKincaid: number | null;
  meanJudgeOverall: number | null;
}

function mean(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}

/**
 * Which trips every model has actually planned — the only set an aggregate may average over.
 *
 * A benchmark that averages "whatever cells exist per model" compares models on different trips.
 * Mid-sweep that is guaranteed: the model the sweep reached first has results for trips the others
 * haven't seen, so its column silently reflects an easier or harder set. This showed up for real —
 * Haiku sat on 2 trips while Sonnet and Opus had 1, and the aggregate row looked like a
 * like-for-like comparison. Trips missing any model are excluded until they're complete.
 */
export function balancedPanel(
  cells: BenchCell[],
  modelIds: string[]
): { included: string[]; excluded: string[] } {
  const byFixture = new Map<string, Set<string>>();
  for (const cell of cells) {
    const models = byFixture.get(cell.fixtureId) ?? new Set<string>();
    models.add(cell.model);
    byFixture.set(cell.fixtureId, models);
  }
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [fixtureId, models] of byFixture) {
    (modelIds.every((m) => models.has(m)) ? included : excluded).push(fixtureId);
  }
  return { included, excluded };
}

/**
 * Per-model aggregates over the balanced panel only. `modelIds` is the configured model list — the
 * completeness bar. Pass it explicitly rather than deriving it from the cells, or a model that has
 * never run would make every trip look "complete".
 */
export function aggregateByModel(cells: BenchCell[], modelIds: string[]): ModelAggregate[] {
  const { included } = balancedPanel(cells, modelIds);
  const comparable = new Set(included);
  const panelCells = cells.filter((c) => comparable.has(c.fixtureId));

  const byModel = new Map<string, BenchCell[]>();
  // Seed every configured model so one that hasn't run yet still gets a row, with zero cells,
  // rather than vanishing from the table as though it were never part of the comparison.
  for (const id of modelIds) byModel.set(id, []);
  for (const cell of panelCells) {
    const list = byModel.get(cell.model) ?? [];
    list.push(cell);
    byModel.set(cell.model, list);
  }

  return [...byModel.entries()].map(([model, list]) => {
    const ok = list.filter((c) => !c.scores.operational.failed);
    const violationsByType: Record<string, number> = {};
    for (const cell of ok) {
      for (const [type, count] of Object.entries(cell.scores.constraints.byType)) {
        violationsByType[type] = (violationsByType[type] ?? 0) + count;
      }
    }

    const costs = ok.map((c) => c.scores.operational.costUsd).filter((c): c is number => c !== null);

    return {
      model,
      cells: list.length,
      failures: list.length - ok.length,
      radar: Object.fromEntries(
        RADAR_AXES.map(({ key }) => [key, mean(ok.map((c) => radarValues(c.scores)[key]))])
      ),
      composite: mean(ok.map((c) => c.composite)),
      meanLatencyMs: mean(ok.map((c) => c.scores.operational.latencyMs)),
      meanCostUsd: mean(costs),
      totalCostUsd: costs.length > 0 ? costs.reduce((s, c) => s + c, 0) : null,
      meanInputTokens: mean(ok.map((c) => c.scores.operational.inputTokens)),
      meanOutputTokens: mean(ok.map((c) => c.scores.operational.outputTokens)),
      violationsByType,
      meanUnlistedRate: mean(ok.map((c) => c.scores.grounding.unlistedRate)),
      meanContradictionRate: mean(ok.map((c) => c.scores.grounding.contradictionRate)),
      meanRelevance: mean(ok.map((c) => c.scores.semantic.relevance)),
      formatPassRate: ok.length > 0 ? ok.filter((c) => c.scores.format.pass).length / ok.length : 0,
      meanGeoCoherence: mean(ok.map((c) => c.scores.geoCoherence.normalized)),
      meanCoverage: mean(ok.map((c) => c.scores.coverage.normalized)),
      meanGrounding: mean(ok.map((c) => c.scores.grounding.normalized)),
      meanFeasibility: mean(ok.map((c) => c.scores.feasibility.normalized)),
      meanFormat: mean(ok.map((c) => c.scores.format.normalized)),
      meanBacktrack: mean(ok.map((c) => c.scores.backtrack?.normalized ?? null)),
      meanExcessKm: mean(
        ok.flatMap((c) => c.scores.backtrack?.perDayExcessKm ?? []).filter((v) => v !== null)
      ),
      meanMealProximity: mean(ok.map((c) => c.scores.mealProximity?.normalized ?? null)),
      mealDetours: ok.reduce((s, c) => s + (c.scores.mealProximity?.detours.length ?? 0), 0),
      meanDowntime: mean(ok.map((c) => c.scores.downtime?.normalized ?? null)),
      tightDays: ok.reduce((s, c) => s + (c.scores.downtime?.tightDays.length ?? 0), 0),
      meanWeatherAlignment: mean(ok.map((c) => c.scores.weather?.normalized ?? null)),
      weatherApplicableCells: ok.filter((c) => c.scores.weather?.applicable).length,
      meanBudget: mean(ok.map((c) => c.scores.budget?.normalized ?? null)),
      overBudgetCells: ok.filter((c) => c.scores.budget && !c.scores.budget.withinBudget).length,
      meanEstimatedUsd: mean(ok.map((c) => c.scores.budget?.estimatedUsd ?? null)),
      meanVibe: mean(ok.map((c) => c.scores.vibe?.normalized ?? null)),
      meanVibeJaccard: mean(ok.map((c) => c.scores.vibe?.jaccard ?? null)),
      meanWords: mean(ok.map((c) => c.scores.lexical.words)),
      meanTypeTokenRatio: mean(ok.map((c) => c.scores.lexical.typeTokenRatio)),
      meanBigramRepetition: mean(ok.map((c) => c.scores.lexical.bigramRepetitionRate)),
      meanFleschKincaid: mean(ok.map((c) => c.scores.lexical.fleschKincaidGrade)),
      meanJudgeOverall: mean(ok.map((c) => c.scores.judge?.overall ?? null)),
    };
  });
}

/** Re-exported so server-side callers have one import site; the implementation is dependency-free
 *  in ./pareto so the client chart can use it too. */
export { paretoFrontier } from "./pareto";
