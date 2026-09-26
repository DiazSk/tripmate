/** Result shapes for every scorer. One file so the API route, the DB row and the UI agree. */

/**
 * Booked flights/stay. This used to be a local duplicate, declared here because `UserAnswers` had
 * no `logistics` field and the traveler-facing form didn't collect one. It does now, so the
 * benchmark reads the same shape the app writes.
 *
 * `usableSlot()` still reads it structurally off `userAnswers`, which keeps the rule a no-op for
 * every fixture and stored trip written before the field existed.
 */
export type { TripLogistics } from "../types";

export type ScorerKind = "deterministic" | "lexical" | "operational" | "model-judged";

export type ViolationType =
  | "opening_hours"
  | "closed_day"
  | "daylight"
  | "pace"
  | "mobility"
  | "crowd_bias";

export const VIOLATION_TYPES: ViolationType[] = [
  "opening_hours",
  "closed_day",
  "daylight",
  "pace",
  "mobility",
  "crowd_bias",
];

export interface GeoCoherenceScore {
  /** Mean inter-stop travel minutes within each day; null for days with <2 locatable stops. */
  perDayMeanMinutes: (number | null)[];
  tripMeanMinutes: number | null;
  tripMeanKm: number | null;
  /** How many consecutive-stop pairs could be located at all — the score's own denominator. */
  matchedLegs: number;
  totalLegs: number;
  /** 0-1, higher is better. Null when nothing could be measured. */
  normalized: number | null;
}

export interface ConstraintViolationScore {
  total: number;
  byType: Record<ViolationType, number>;
  /** How many entries were actually checkable per type — an unchecked type isn't a clean one. */
  checkedByType: Record<ViolationType, number>;
  details: { type: ViolationType; dayIndex: number; detail: string }[];
  normalized: number | null;
}

export interface FeasibilityScore {
  /** Pairs of entries in the same day whose time windows overlap. */
  overlaps: number;
  /** Days whose activity + travel minutes exceed the waking-hours budget. */
  overBudgetDays: number;
  perDayLoadMinutes: (number | null)[];
  wakingBudgetMin: number;
  normalized: number | null;
}

export interface CoverageScore {
  starredCovered: number;
  starredTotal: number;
  anchorsIncluded: number;
  anchorsTotal: number;
  missingStarred: string[];
  missingAnchors: string[];
  normalized: number | null;
}

export interface GroundingScore {
  /** Entries that name a specific place (area-level meal/stroll slots excluded). */
  namedStops: number;
  /** Named stops absent from the candidate + anchor set. Expected when anchors are sparse. */
  unlistedStops: number;
  unlistedRate: number | null;
  /** Entries asserting a fact the context doesn't contain (hours/travel times it never gave). */
  contextContradictions: number;
  contradictionRate: number | null;
  examples: string[];
  normalized: number | null;
}

export interface FormatAdherenceScore {
  pass: boolean;
  /** Fraction of structural checks passed. */
  normalized: number;
  checks: { name: string; passed: boolean; detail?: string }[];
  missingFields: string[];
}

export interface LexicalScore {
  words: number;
  /** Rough char/4 estimate — the CLI's own token counts live in `operational`. */
  approxTokens: number;
  typeTokenRatio: number;
  bigramRepetitionRate: number;
  trigramRepetitionRate: number;
  fleschKincaidGrade: number;
}

export interface SemanticScore {
  /** Cosine(output, the trip's priorities + flags) over local TF-IDF vectors. NOT embeddings. */
  relevance: number | null;
  method: string;
}

export interface OperationalScore {
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** From the configurable per-model price table. */
  costUsd: number | null;
  /** What the CLI itself reported, when it did — kept beside the computed figure, not merged. */
  cliReportedCostUsd: number | null;
  /** The output parsed into at least one day with at least one entry. */
  parsedOk: boolean;
  failed: boolean;
  errorMessage: string | null;
}

export interface JudgeScore {
  desirability: number;
  realism: number;
  overall: number;
  rationale: string;
  /** The anonymous label the judge saw, so a blinding bug is visible after the fact. */
  blindLabel: string;
}

export interface BacktrackScore {
  /** Optimal/actual path length per day; null for days with <3 locatable stops (no ordering to judge). */
  perDayRatio: (number | null)[];
  /** Kilometres walked beyond the optimal ordering of the same stops. */
  perDayExcessKm: (number | null)[];
  scoredDays: number;
  totalDays: number;
  /** False when a day was large enough to fall back to the heuristic solver. */
  exact: boolean;
  worstDay: { dayIndex: number; ratio: number; actualKm: number; optimalKm: number } | null;
  normalized: number | null;
}

export interface MealProximityScore {
  mealSlots: number;
  /** Slots whose hop from the previous stop could actually be measured. */
  measured: number;
  within: number;
  capMinutes: number;
  detours: { dayIndex: number; name: string; minutes: number; source: string }[];
  normalized: number | null;
}

export interface DowntimeScore {
  perDayUnallocatedMin: (number | null)[];
  scoredDays: number;
  passedDays: number;
  totalDays: number;
  minimumMinutes: number;
  tightDays: { dayIndex: number; unallocatedMin: number; activeSpanMin: number }[];
  normalized: number | null;
}

export interface WeatherAlignmentScore {
  adverseDays: number;
  classifiedStops: number;
  outdoorOnAdverseDays: number;
  violations: { dayIndex: number; name: string; reason: string; noted: boolean }[];
  /** False when the trip has no adverse days (or none could be classified) — then `normalized` is null. */
  applicable: boolean;
  reason: string;
  normalized: number | null;
}

export interface BudgetScore {
  estimatedUsd: number;
  budgetUsd: number;
  withinBudget: boolean;
  pricedStops: number;
  breakdown: Record<string, number>;
  excludes: string[];
  /** Always true: the pipeline carries no prices, so this rests on a configurable estimate table. */
  estimateBased: boolean;
  /** How much of the stated budget the trip's total uses. Reported, not scored: §5 now treats a
   *  budget as a ceiling, so a plan landing at 40% is thrift rather than a miss. This is what
   *  keeps the underspend visible now that `normalized` no longer penalises it. Null when not
   *  measurable. */
  budgetUsedFraction: number | null;
  normalized: number | null;
}

export interface VibeScore {
  tripTags: string[];
  stopTags: string[];
  classifiedStops: number;
  matchedStops: number;
  offBrief: { dayIndex: number; name: string; tags: string[] }[];
  /** Set similarity between the traveler's tags and the plan's tags — breadth, not per-stop rate. */
  jaccard: number | null;
  normalized: number | null;
}

/** The five weighted groups the composite is built from, each 0-1 or null when unmeasurable. */
export interface CompositeGroups {
  routeEfficiency: number | null;
  constraintAdherence: number | null;
  weatherFeasibility: number | null;
  mealVibeAlignment: number | null;
  coverageGrounding: number | null;
}

/**
 * The three §0/§14e requirement axes, scored beside the composite rather than inside it.
 *
 * Each `normalized` is `null` — never 1.0 — when the fixture states nothing to check. Six of the
 * eight built-in fixtures name no must-includes and no logistics, and scoring those a perfect 1.0
 * would drown the two that do under six free passes.
 */
export interface DuplicateScore {
  /** Entries with a usable name — the denominator `repeats` is a fraction of. */
  checkedStops: number;
  /** Stops that were already in the trip, by name or by proximity. */
  repeats: number;
  /** Name repeats of a sight — not a meal, transit leg or rest entry, and never proximity alone.
   *  The subset the critical gate counts: two museums 100m apart are two places, and "Breakfast at
   *  hotel" on four mornings is a routine, not §14e sending someone back to the same place. */
  hardRepeats: number;
  examples: { dayIndex: number; name: string; priorName: string; by: "name" | "proximity" }[];
  normalized: number | null;
}

export interface MustIncludeScore {
  /** Must-includes found in the plan, over the ones stated. */
  includedCount: number;
  missing: string[];
  /** Exclusions the plan does not breach, over the ones stated. */
  respectedCount: number;
  violated: { term: string; stopName: string }[];
  /** Must-includes + exclusions stated. 0 means the axis is unmeasurable. */
  checked: number;
  normalized: number | null;
}

export interface CommitmentScore {
  /** Individual stop/lodging checks the stated logistics made possible. */
  checked: number;
  passed: number;
  breaches: { dayIndex: number; name: string; reason: "arrival" | "departure" | "prepaid" }[];
  normalized: number | null;
}

export interface DietaryScore {
  /** Entries categorised `food` — the denominator. */
  foodStops: number;
  /** Food stops whose text names something the stated diet or allergy rules out. */
  contradictions: number;
  /** Food stops that mention the diet (or a synonym) at all. Reported, never critical. */
  acknowledged: number;
  /** `"<stop name>: <term>"` for each contradiction, for the report. */
  flagged: string[];
  /** 1 − contradictions/foodStops; null when no diet was stated or there are no food stops. */
  normalized: number | null;
}

export interface BenchCellScores {
  geoCoherence: GeoCoherenceScore;
  constraints: ConstraintViolationScore;
  feasibility: FeasibilityScore;
  coverage: CoverageScore;
  grounding: GroundingScore;
  format: FormatAdherenceScore;
  backtrack: BacktrackScore;
  mealProximity: MealProximityScore;
  downtime: DowntimeScore;
  weather: WeatherAlignmentScore;
  budget: BudgetScore;
  duplicates: DuplicateScore;
  commitments: CommitmentScore;
  mustInclude: MustIncludeScore;
  dietary: DietaryScore;
  vibe: VibeScore;
  lexical: LexicalScore;
  semantic: SemanticScore;
  operational: OperationalScore;
  judge: JudgeScore | null;
}

/** One (fixture × model) run. */
export interface BenchCell {
  fixtureId: string;
  model: string;
  runId: string | null;
  traceId: string | null;
  itineraryMd: string;
  scores: BenchCellScores;
  /** Mean of the five normalized radar axes. Null if any axis was unmeasurable. */
  composite: number | null;
  createdAt: string;
}

/** Pairwise cosine between two models' outputs on the same fixture. Computed across cells. */
export interface ModelAgreement {
  fixtureId: string;
  modelA: string;
  modelB: string;
  cosine: number;
}

/**
 * The composite's weights, as specified. They sum to 1.0.
 *
 * Note what is NOT weighted: `format_adherence`, `budget_accuracy` and the three requirement axes
 * (`duplicates`, `commitments`, `must_include`) are computed and shown, but none appears in these
 * five groups, so none moves the composite. That's deliberate rather than an oversight — flagged
 * so it can be changed on purpose.
 *
 * For the three newest it is also what makes the A/B readable: every composite already recorded in
 * docs/itinerary-quality.md was scored without them, and folding a sixth group in would silently
 * re-base every prior number. They are reported beside the composite instead.
 */
export const COMPOSITE_WEIGHTS: Record<keyof CompositeGroups, number> = {
  routeEfficiency: 0.15,
  constraintAdherence: 0.25,
  weatherFeasibility: 0.15,
  mealVibeAlignment: 0.15,
  coverageGrounding: 0.3,
};

/** What each weighted group is made of, for the UI's explanation of the composite. */
export const COMPOSITE_GROUP_PARTS: Record<keyof CompositeGroups, string[]> = {
  routeEfficiency: ["geo_coherence", "geo_backtrack_ratio"],
  constraintAdherence: ["constraint_violations"],
  weatherFeasibility: ["weather_alignment", "feasibility", "downtime_margin"],
  mealVibeAlignment: ["meal_proximity", "vibe_match"],
  coverageGrounding: ["coverage", "grounding"],
};

export const RADAR_AXES = [
  { key: "routeEfficiency", label: "Route efficiency" },
  { key: "constraintAdherence", label: "Constraint adherence" },
  { key: "weatherFeasibility", label: "Weather & feasibility" },
  { key: "mealVibeAlignment", label: "Meal & vibe" },
  { key: "coverageGrounding", label: "Coverage & grounding" },
] as const;

export type RadarAxis = (typeof RADAR_AXES)[number]["key"];

/**
 * What the patch itself did, as distinct from what the patched trip looks like.
 *
 * `applyPatch` validates positions but not payloads: `add_stop` clamps its index instead of
 * rejecting, `replace_lodging` is unchecked, and `replace_stop` merges — so a near-empty payload
 * applies cleanly. `rejected` alone therefore understates a bad patch, which is why
 * `guardrailDelta` is here beside it.
 */
export interface RefinePatchScore {
  opsEmitted: number;
  opsRejected: number;
  rejectedReasons: string[];
  /** Fraction of emitted ops that landed. Null when none were emitted — nothing to measure. */
  applied: number | null;
  /** Fraction of modified days inside the task's allowed set. Null when the task allows any day. */
  scope: number | null;
  /** Did emitting-or-not match what the task asked for. */
  restraint: boolean;
  guardrailsBefore: number;
  guardrailsAfter: number;
  /** after − before. Negative is an improvement; positive means the patch broke something. */
  guardrailDelta: number;
  /** 0-1 roll-up of the four above. */
  normalized: number | null;
}

export interface RefineCellScores {
  before: BenchCellScores;
  after: BenchCellScores;
  /** after − before per weighted group. Null where either side was unmeasurable. */
  delta: CompositeGroups;
  /**
   * How many of `delta`'s five groups were non-null and so contributed to `refineComposite`.
   *
   * `refineComposite` deliberately has no equivalent of `compositeScore`'s
   * `MIN_GROUPS_FOR_COMPOSITE` gate: a delta answers "did this patch make the trip worse," and one
   * group reporting a real drop is still real information, not a verdict to withhold the way a
   * thin absolute score would be. But an ungated composite hides its own denominator — a composite
   * built from one group reads identical to one built from five. This field is what keeps cells
   * comparable instead of discarding that signal. `0` is a legitimate, measured value ("no group
   * was measurable"), not an absence, so it is a number and never null.
   */
  measuredGroups: number;
  /** Null when the call itself failed. An empty `ops` array from a timeout is indistinguishable
   *  from a deliberate no-op, so scoring a dead call would report `restraint: true` for a model
   *  that never answered. Consumers must skip null rather than treat it as a zero. */
  patch: RefinePatchScore | null;
  operational: OperationalScore;
}

/** One (fixture × task × model) refine run. */
export interface RefineCell {
  fixtureId: string;
  taskId: string;
  model: string;
  runId: string | null;
  traceId: string | null;
  /** The model's raw JSON response, verbatim — stored so a bad patch is inspectable after the fact. */
  rawResponse: string;
  scores: RefineCellScores;
  composite: number | null;
  createdAt: string;
}
