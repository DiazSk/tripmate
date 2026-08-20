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
