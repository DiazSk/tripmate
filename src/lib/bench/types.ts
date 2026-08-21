/** Result shapes for every scorer. One file so the API route, the DB row and the UI agree. */

/**
 * Booked flights/stay. This used to be a local duplicate, declared here because `UserAnswers` had
 * no `logistics` field and the traveler-facing form didn't collect one. It does now, so the
 * benchmark reads the same shape the app writes.
 *
 * `usableSlot()` still reads it structurally off `userAnswers`, which keeps the rule a no-op for
 * every fixture and stored trip written before the field existed.
 */
/** Re-exported rather than declared a second time: this shape is now `UserAnswers.logistics` in
 *  src/lib/types.ts, and two copies of it is how they drift. `bench/customTrip.ts` imports it from
 *  here by this name. */
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
  /** True when the total rests on the configurable estimate table because the output carried no
   *  `$cost` fields; false when it's the model's own stated costs, which §11 now requires. */
  estimateBased: boolean;
  /** How much of the trip's total is the traveler's target. §5 asks for 85-100% of the budget, so
   *  a plan that lands at 40% is a miss in the other direction — one the estimate table could
   *  never see, since it priced stops rather than reading them. Null when not measurable. */
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
 * Note what is NOT weighted: `format_adherence` and `budget_accuracy` are computed and shown, but
 * neither appears in these five groups, so neither moves the composite. That's deliberate rather
 * than an oversight — flagged so it can be changed on purpose.
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
  patch: RefinePatchScore;
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
