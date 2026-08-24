import type { DayWeather } from "./weather";
import type { TierId } from "./tiers";
import type { Holiday } from "./holidays";
import type { CandidatePoi } from "./pois";
import type { DietaryNeeds } from "./travelerProfile";

export type StopCategory = "food" | "entry" | "transit" | "other";

export interface Stop {
  name: string;
  lat: number;
  lng: number;
  cost: number;
  /** Line 2 of the stop's two lines: the practical detail (walkable from the last stop, best
   *  time to arrive, what to order). */
  note: string;
  /** Line 1: why this stop suits *this* traveler. Optional because itineraries saved before
   *  this field existed won't carry it. */
  why?: string;
  time: string;
  durationLabel: string;
  /** @deprecated Replaced by the `why` + `note` pair — no longer requested from the model or
   *  rendered. Kept optional so previously saved itineraries still parse. */
  tags?: string[];
  category: StopCategory;
  actualCost?: number;
}

export interface Lodging {
  name: string;
  cost: number;
  note: string;
  actualCost?: number;
}

export interface DayPlan {
  date: string;
  weather: string;
  /** Structured forecast for this date, attached server-side from the real
   *  weather lookup (not authored by the model) — used for the icon/popover.
   *  Absent on itineraries saved before this field existed. */
  weatherDetail?: DayWeather;
  /** Short model-written narrative for the day's theme/flow. Absent on
   *  itineraries saved before this field existed. */
  summary?: string;
  /** User-authored day title (e.g. "Arrival Day"), set via the day header's
   *  edit control — never written by the model. */
  title?: string;
  lodging?: Lodging;
  stops: Stop[];
}

export interface Itinerary {
  tier: TierId;
  days: DayPlan[];
  /** Real round-trip airfare, deducted from the stated budget before the plan was written.
   *
   *  Lives here rather than in a DB column so it persists for free — the whole `Itinerary` is
   *  `JSON.stringify`'d into `trips.itinerary_json`. Absent on itineraries generated before this
   *  existed, and on any trip where no origin was given, so every reader must tolerate
   *  `undefined` (same contract as `DayPlan.weatherDetail`/`summary`/`title`).
   *
   *  Deliberately NOT part of the `tripSpend` chain in itinerary.ts: this is a trip-level cost and
   *  that chain is per-day, so folding it in would break the day-sums-to-trip arithmetic the print
   *  page depends on. It is shown beside those figures, never inside them. */
  flightCostUsd?: number;
}

export interface TripSummary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
}

export interface Trip extends TripSummary {
  itinerary: Itinerary;
  /** The Step 2b answers captured when the trip was saved. Null for trips saved before this was
   *  stored — the edit loop degrades to asking rather than assuming. */
  userAnswers?: UserAnswers | null;
}

export interface PlaceDetail {
  history: string;
  bestTime: string;
  tips: string[];
  duration: string;
}

export interface ItineraryPreferences {
  tags: string[];
  vibe: string | null;
}

export interface DestinationContext {
  /** `sourceUrl` is null for shopping/trends (still model-recalled) and populated for
   *  festivals/safety, which are grounded in a real fetched source — see destinationSafety.ts
   *  and destinationFestivals.ts. */
  festivals: { name: string; dates: string; note: string; sourceUrl: string | null }[];
  safety: { note: string; severity: "low" | "medium" | "high"; sourceUrl: string | null }[];
  shopping: { name: string; area: string; note: string }[];
  trends: { note: string }[];
}

// --- Step 2a: raw_fetch bundle -------------------------------------------------------------

export interface DateContext {
  tripDays: number;
  leadTimeDays: number;
  /** Null when the destination hasn't resolved to a real lat/lon — season needs a hemisphere. */
  season: "winter" | "spring" | "summer" | "fall" | null;
  days: { date: string; dayOfWeek: string }[];
}

export interface DestinationBasics {
  resolved: boolean;
  lat: number | null;
  lon: number | null;
  timezone: string | null;
  /** e.g. "Kyoto Prefecture, Japan" — admin1 + country, joined where both are known. */
  region: string | null;
  countryCode: string | null;
}

/** Everything Step 2a fetches, handed to Step 3 as one bundle. Every source carries its own
 *  `available` flag so one source being down never invalidates the rest of the bundle. */
export interface RawFetch {
  dateContext: DateContext;
  destination: DestinationBasics;
  weather: { available: boolean; historical: boolean; days: DayWeather[] };
  holidays: { available: boolean; events: Holiday[] };
  /** No reliable free data source exists for this yet — always `available: false` today.
   *  See the itinerary-planner Step 2a audit; kept as an explicit gap rather than fabricated
   *  data or an LLM call (2a is plain fetching, not generation). */
  transportModes: { available: boolean; modes: string[] };
  candidatePois: { available: boolean; pois: CandidatePoi[] };
}

// --- Step 2b: user_answers -------------------------------------------------------------------

export type ExplorerStyle = "packed" | "relaxed" | "offbeat" | "mixed";
export type GroupType = "solo" | "couple" | "family_with_kids" | "other";
export type Pace = "slow" | "moderate" | "fast";

/** Who the traveler is, rather than where they've already decided to go. These drive stop
 *  selection: the model reasons from the profile outward to places, instead of being handed a
 *  list of names. Adult age is still deliberately not collected — `energy` is the
 *  planning-relevant signal there ("will happily walk all day" vs "wants a bench every hour") and
 *  it's answerable directly. Children are the exception (see `PartyCounts`): a stroller and a nap
 *  window are constraints no adult-facing energy answer can express. */
export type EnergyLevel = "high" | "moderate" | "low";
export type CrowdPreference = "love" | "mixed" | "avoid";

/** Age bands, not exact ages — the bands are what map onto a planning rule (stroller access, nap
 *  windows, ride height limits), and asking for a precise age would imply a precision that changes
 *  nothing. Mirrors how flight booking collects a party, which is where travelers have met it. */
export interface PartyCounts {
  /** At least 1. */
  adults: number;
  /** Aged 2-11. */
  children: number;
  /** Under 2. */
  infants: number;
}

/** What the traveler has already booked around the trip. Every field is nullable and the whole
 *  object is optional: this is the one part of the form nobody is required to fill in, and a rule
 *  that reads it must no-op rather than guess (see `usableSlot` in the benchmark scorers).
 *
 *  Deliberately times, not dates. `startDate`/`endDate` stay the trip's only date range — a second
 *  one would give the app two competing notions of trip length, and tier pricing, the day count and
 *  the weather window all read the first. */
export interface TripLogistics {
  /** "HH:MM", local, on `startDate`. */
  arrivalTime: string | null;
  /** Free text — "Kansai Intl (KIX)", "Kyoto Station". Deliberately not geocoded: it is a fact for
   *  the prompt, and a lookup would add a fetch that can fail for no planning gain. */
  arrivalPoint: string | null;
  /** "HH:MM", local, on `endDate`. */
  departureTime: string | null;
  departurePoint: string | null;
  /** Collected by the benchmark form only; the traveler-facing form does not write it yet. */
  stayBooked: string | null;
  /** Free text — "Boston", "Boston (BOS)" — where the traveler is flying from, not where they
   *  land. Unlike `arrivalPoint`/`departurePoint` this exists to be resolved: a real flight
   *  search needs a departure airport code, which nothing in this app collects otherwise. C1 only
   *  collects and resolves it (see `arrivalPoints.ts`'s airport-finder, reused unmodified); what a
   *  real flight search is used FOR is a separate, not-yet-decided piece. */
  originCity: string | null;
}

/** Normalized, enum-like flags the itinerary-planner skill branches on — never free text where
 *  a fixed choice is expected. Pace and the other resolved flags are derived in code from these
 *  (see `deriveFlags`), never asked — the traveler answers who they are, not how fast to go. */
export interface UserAnswers {
  purpose: string;
  explorerStyle: ExplorerStyle;
  group: GroupType;
  /** Free text, meaningful only when `group` is "other" — "five college friends", "work offsite". */
  groupOther?: string;
  /** Optional on purpose: every one of these three is absent from rows written before the field
   *  existed, so each reader treats absence as "not asked" rather than rejecting the row. */
  party?: PartyCounts;
  /** What the traveler has already committed to, which outranks anything the model would pick.
   *  Every rule that reads these degrades rather than assuming when they are absent. */
  logistics?: TripLogistics | null;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  budget: number;
  /** Every tag the traveler selected. */
  priorities: string[];
  /** The (up to) 3 they starred, in the order starred — the primary weighting signal.
   *  Everything in `priorities` but not here is a tie-breaker only. */
  topPriorities: string[];
  /** Optional anchors only. Empty is normal and expected — the model selects stops from the
   *  traveler profile above; these just pin anything already decided on. */
  selectedPois: CandidatePoi[];
  customPois: string[];
  /** Carried per-trip even though it lives on the profile: the legacy prompt has had this since
   *  `formatDietary` shipped, and the staged pipeline dropped it silently — a food stop the
   *  traveler cannot eat at is the worst defect this app can produce. Both fields empty means
   *  "no restrictions", which is different from the field being absent. */
  dietary?: DietaryNeeds | null;
  /** Mobility needs stated directly, rather than inferred from `energy`. Absent means nothing was
   *  stated — NOT that the traveler has no needs. */
  accessibility?: AccessibilityNeeds | null;
}

/**
 * Fixed commitments the plan has to bend around: a booked bed, and the two clock times that bound
 * the first and last usable day. Stated by the traveler, never guessed; `null` per field means
 * "not stated".
 *
 * These field names are not new — `src/lib/bench/customTrip.ts` has been assigning exactly this
 * shape to `userAnswers.logistics` since the harness landed, against a field `UserAnswers` never
 * actually declared (a latent type error). Declaring it here with the bench's own names fixes that
 * rather than adding a second, differently-named copy.
 */
export interface TripLogistics {
  /** Local "HH:MM" on the first day. */
  arrivalTime: string | null;
  /** Local "HH:MM" on the last day. */
  departureTime: string | null;
  /** Free text, e.g. "Hotel Granvia Kyoto" or "Airbnb in Gion". */
  stayBooked: string | null;
}

/** Asked directly rather than derived: `energy` answers "how much do you want to walk", which is
 *  a different question from "can you manage stairs". `deriveMobilityProfile` used `energy` as a
 *  proxy for both, and a wheelchair user who describes their energy as high got no accommodation
 *  at all. */
export interface AccessibilityNeeds {
  /** Step-free routes required throughout — the hard constraint, not a preference. */
  stepFreeRequired: boolean;
  /** Stairs and steep climbs are manageable but should be avoided where an alternative exists. */
  limitStairs: boolean;
  /** Anything the two flags above don't cover. */
  note: string;
}

// --- Step 2b → 3: derived flags ---------------------------------------------------------------

export interface MobilityProfile {
  walkLegCap: "tight" | "normal";
  minimizeStairs: boolean;
  restBreaks: boolean;
  preferTransitOverLongWalks: boolean;
}

export interface CrowdBias {
  preferOffpeakTiming: boolean;
  boostOffbeatPois: boolean;
  scheduleIconsAtOffpeak: boolean;
  marketsAndLivelyOk: boolean;
  peakTimingOk: boolean;
}

export interface FamilyRules {
  kidFriendlyBias: boolean;
  noLateNight: boolean;
  shortTravelLegs: boolean;
  /** Infants: step-free routes and somewhere to park a pushchair. */
  strollerAccess: boolean;
  /** Infants: leave a usable gap in the middle of the day rather than packing it. */
  napWindow: boolean;
  /** The binding constraint — an infant's day and an eleven-year-old's are not the same day.
   *  Null when the rules fired on the group type alone, with no counts given. */
  youngestBand: "infant" | "child" | null;
}

/** Computed from `UserAnswers` in code (never asked, never model-generated) and written into
 *  trip-context as the flags the skill branches on. Pace is the headline: `explorer_style` only
 *  sets a ceiling, and reality steps it down from there. */
export interface ResolvedFlags {
  /** Spots-per-day target after every step-down, floored. */
  paceSpotsPerDay: number;
  paceResolved: Pace;
  mobilityProfile: MobilityProfile;
  crowdBias: CrowdBias;
  /** Starred tags first (primary drivers), then the rest as tie-breakers. */
  prioritiesRanked: { primary: string[]; tiebreakers: string[] };
  /** Present whenever the party actually includes children, whatever group type was picked. */
  familyRules: FamilyRules | null;
  /** Total heads, for lodging capacity and table sizing. Null when no party was given. */
  partySize: number | null;
  /** The group in words — the traveler's own description when they picked "other", the pill's
   *  label otherwise. `formatTravelerProfile` only ever receives resolved flags, so without this
   *  the legacy prompt carried no group at all: "solo" and "couple" never reached the model, and
   *  the free-text "other" description would have been collected and discarded. */
  groupLabel: string;
}

// --- Step 3: join / barrier ------------------------------------------------------------------

export type TransportMode = "walk" | "transit" | "drive";

/** Why a field is the value it is: fetched for real, degraded to a flagged default, or absent
 *  entirely. Downstream steps read this instead of guessing from empty arrays. */
export type FieldStatus = "ok" | "estimated" | "unavailable";

export interface ReconcileNote {
  field: string;
  status: FieldStatus;
  detail: string;
}

/** Output of the Step 3 barrier: both tracks' bundles plus per-field provenance. Only a truly
 *  unusable state (no POIs from either source) sets `usable: false`; everything else degrades
 *  to a flagged default and keeps the pipeline moving. */
export interface ReconciledTrip {
  usable: boolean;
  /** Set only when `usable` is false — a user-facing message, matching the app's `{ error }`
   *  route convention. */
  error: string | null;
  rawFetch: RawFetch;
  userAnswers: UserAnswers;
  /** Derived from `userAnswers` at reconcile time — the normalized flags trip-context writes
   *  and the skill branches on. Kept alongside the raw answers, not instead of them. */
  resolvedFlags: ResolvedFlags;
  transportModes: TransportMode[];
  /** Union of the user's picks from the candidate list and their own custom entries — the
   *  authoritative POI set for Step 4 onward. Custom entries have no coordinates yet. */
  selectedPois: { name: string; lat: number | null; lon: number | null; kinds: string | null }[];
  notes: ReconcileNote[];
}

// --- Step 4: POI detail fetch ----------------------------------------------------------------

export interface PoiOsmTags {
  openingHours: string | null;
  lat: number | null;
  lon: number | null;
  /** OSM `wheelchair=yes|limited|no`. Already present in the tags Overpass returns — it was being
   *  discarded, which left `minimize_stairs` as a rule with no fact to act on. */
  wheelchair: "yes" | "limited" | "no" | null;
}

export interface TravelLeg {
  from: string;
  to: string;
  mode: TransportMode;
  distanceKm: number;
  minutes: number;
  /** Always true today: legs are haversine + a speed constant, not road-network routing. */
  estimated: boolean;
}

export interface EnrichedPoi {
  name: string;
  lat: number | null;
  lon: number | null;
  openingHours: string | null;
  /** Null when hours are absent or use syntax too complex to parse confidently. */
  closedDays: string[] | null;
  visitMinutes: number;
  visitMinutesEstimated: boolean;
  /** Null/absent means OSM has no `wheelchair` tag for this place — genuinely unknown, not "no".
   *  Optional because every construction site predating the field is still a valid POI. */
  wheelchair?: "yes" | "limited" | "no" | null;
  /** True when nothing could be resolved for this POI — it still ships, with unknown fields. */
  partial: boolean;
}

export interface PoiDetails {
  pois: EnrichedPoi[];
  travelLegs: TravelLeg[];
  notes: ReconcileNote[];
}

export interface CritiqueResult {
  issues: string[];
  revisedDays: DayPlan[] | null;
}

export interface TraceSummary {
  id: string;
  type: string;
  status: string;
  model: string;
  durationMs: number | null;
  createdAt: string;
}

export interface TraceDetail extends TraceSummary {
  prompt: string;
  rawResponse: string | null;
  errorMessage: string | null;
}

/** "success": every step ok. "partial_failure": the primary step (generate/
 *  refine/rebalance) succeeded but a secondary step (context/critique/
 *  place-detail) errored or timed out. "failed": the primary step itself
 *  failed. Computed on read from the run's steps, never stored. */
export type RunStatus = "success" | "partial_failure" | "failed" | "pending";

export interface RunStepUsage {
  /** The UNCACHED prompt remainder only — not the prompt size. See `cache*` below. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** Prompt tokens served from cache. Billed at ~0.1x input. */
  cacheReadInputTokens?: number | null;
  /** Prompt tokens written to cache this call. Billed at ~1.25x input. */
  cacheCreationInputTokens?: number | null;
}

export interface RunStep extends TraceDetail {
  usage: RunStepUsage;
}

export interface RunSummary {
  id: string;
  kind: string;
  destination: string;
  tripId: string | null;
  status: RunStatus;
  totalDurationMs: number;
  stepCount: number;
  stepTypes: string[];
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  steps: RunStep[];
}

/** One matched "role" across two runs — context↔context, the generate/refine
 *  step (whichever kind each run used)↔"generation", critique↔critique.
 *  Place-detail steps have no stable identity across runs, so they're only
 *  counted/summed, never paired here. */
export interface RunComparisonRole {
  role: "context" | "generation" | "critique";
  stepA: RunStep | null;
  stepB: RunStep | null;
  durationDeltaMs: number | null;
  inputTokenDelta: number | null;
  outputTokenDelta: number | null;
}

export interface RunComparison {
  runA: RunSummary;
  runB: RunSummary;
  roles: RunComparisonRole[];
  placeDetailCountA: number;
  placeDetailCountB: number;
  totalDurationDeltaMs: number;
}

export interface MetricStats {
  avg: number | null;
  median: number | null;
  p95: number | null;
}

export interface FeaturePerfStats {
  type: string;
  count: number;
  durationMs: MetricStats;
  timeToRequestMs: MetricStats;
  ttftMs: MetricStats;
  apiDurationMs: MetricStats;
  inputTokens: MetricStats;
  outputTokens: MetricStats;
  costUsd: MetricStats;
}
