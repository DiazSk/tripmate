export type StopCategory = "food" | "entry" | "transit" | "other";
export type TierId = "budget" | "midrange" | "luxury";
export type TripStatus = "draft" | "saved";

export interface Stop {
  name: string;
  lat: number;
  lng: number;
  cost: number;
  note: string;
  why?: string;
  time: string;
  durationLabel: string;
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

export interface DayWeather {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  historical: boolean;
  precipitationProbability?: number;
  humidity?: number;
  weatherCode?: number;
  sunrise?: string;
  sunset?: string;
}

export interface DayPlan {
  // Date-only ISO string ("2026-09-19"). Never format with a local-timezone formatter — parse
  // with the UTC accessors, or it rolls back a day anywhere west of Greenwich.
  date: string;
  weather: string;
  weatherDetail?: DayWeather;
  summary?: string;
  title?: string;
  lodging?: Lodging;
  stops: Stop[];
}

export interface Itinerary {
  tier?: TierId;
  days: DayPlan[];
}

export interface TripSummary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  status?: TripStatus;
}

export interface Trip {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  status?: TripStatus;
  itinerary: Itinerary;
  userAnswers: unknown | null;
  chatSessionId: string | null;
}

export type GroupType = "solo" | "couple" | "family_with_kids" | "other";
export type ExplorerStyle = "packed" | "relaxed" | "offbeat" | "mixed";
export type EnergyLevel = "high" | "moderate" | "low";
export type CrowdPreference = "love" | "mixed" | "avoid";

export interface DietaryNeeds {
  tags: string[];
  note: string;
}

export interface TravelerProfile {
  group: GroupType;
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  priorities: string[];
  topPriorities: string[];
  dietary: DietaryNeeds;
}

export interface PlacePhoto {
  thumbnailUrl: string | null;
  imageUrl: string | null;
  extract: string | null;
}

// ---------------------------------------------------------------------------
// Wizard input. Everything above describes trips coming back; these describe
// one going out.
// ---------------------------------------------------------------------------

/**
 * What the wizard has collected so far.
 *
 * Only `destination`, both dates and a budget above zero are required to generate — every other
 * field defaults and degrades server-side. That is deliberate, and the Swift wizard records why:
 * a required answer on a screen the traveller has nothing to say on is a wall in front of a plan.
 */
export interface PlanDraft {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  /**
   * Set only when a geocode came back a genuine **miss** (404), never when the lookup failed to
   * complete (500). A third-party geocoder's outage is not a claim about what the traveller
   * typed, and neither case ever blocks generating.
   */
  destinationMissed: boolean;
}

export interface GenerateRequest {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  /** Required by the route — a 400 without it — and derived from budget and days, never picked. */
  tier: TierId;
  preferences?: { tags: string[]; vibe?: string | null };
  userAnswers?: unknown;
  dietary?: DietaryNeeds | null;
}

export interface CreateTripRequest {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  itinerary: Itinerary;
  /**
   * **Not optional in practice.** The route reads `status === "draft" ? "draft" : "saved"`, so
   * omitting this creates a *kept* trip and puts an unsaved plan on the memories wall.
   */
  status: TripStatus;
  runId?: string;
  chatSessionId?: string;
  userAnswers?: unknown;
}

/** What `PATCH /api/trips/[id]` answers. `endDate` is recomputed server-side — persist it. */
export interface TripUpdate {
  ok: boolean;
  endDate: string;
  days: number;
  status: TripStatus;
}

export interface GeocodedPlace {
  lat: number;
  lng: number;
  name: string;
}

// --- The generation stream -------------------------------------------------

export type GenerationStage = 'geocode' | 'context' | 'generate' | 'critique' | 'placing';
export type StageStatus = 'start' | 'done' | 'skipped' | 'failed';

export interface StageEvent {
  stage: GenerationStage;
  status: StageStatus;
}

/** A stop as it is parsed out of the model's token stream, before the plan is complete. */
export interface StreamedStop {
  dayIndex: number;
  stopIndex: number;
  date: string;
  stop: Stop;
}

export interface GenerationResult {
  itinerary: Itinerary;
  traceId: string;
  runId: string;
  sessionId?: string;
}

/**
 * Handlers for a streamed generation.
 *
 * `onPlan` is terminal for the caller's purposes: critique still runs after it and takes ~150 s,
 * so the client stops reading there rather than waiting for `done`.
 */
export interface GenerateHandlers {
  onStage?: (event: StageEvent) => void;
  onStop?: (event: StreamedStop) => void;
  onPlan: (result: GenerationResult) => void;
}

/** Why a generation did not produce a plan. Each needs different words in front of a traveller. */
export type GenerateFailure =
  | { kind: 'throttled'; message: string }
  | { kind: 'spendCap'; message: string }
  | { kind: 'failed'; message: string };
