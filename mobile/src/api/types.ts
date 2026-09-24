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

/**
 * A day's forecast, exactly as the server declares it.
 *
 * **The five nullable fields are required-and-nullable, not optional.** They were written here as
 * `?: number`, which reads the same at a call site and is a different type: the backend's own
 * `DayWeather` (`src/lib/weather.ts`) fills every key and uses `null` for "the provider had no
 * figure". Because this app can import that backend's pure logic through `@shared/*`, the two
 * declarations meet — and the mismatch made a `DayPlan` from this file unassignable to the
 * server's, over five fields nothing here even reads (only `tempMaxC`, `tempMinC` and
 * `historical` are used, in `day-page.tsx`).
 *
 * Corrected rather than cast around at the boundary: a cast would have to be written once per
 * shared function and would keep claiming a wire shape the server does not send.
 */
export interface DayWeather {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  historical: boolean;
  precipitationProbability: number | null;
  humidity: number | null;
  weatherCode: number | null;
  /** Local ISO datetime, e.g. "2026-08-14T05:16". */
  sunrise: string | null;
  sunset: string | null;
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

/**
 * What somebody's kept trips add up to, from `GET /api/profile/stats`.
 *
 * `places` counts distinct destinations rather than countries: `destination` is free text with no
 * country on the row, so "countries" could only be guessed at by splitting on a comma — which
 * makes a trip to "Tokyo" a country called Tokyo.
 */
export interface ProfileStats {
  trips: number;
  places: number;
  /** Real spend, honouring any `actualCost`, from the same summation the budget bar uses. */
  spend: number;
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
export interface PartyCounts {
  adults: number;
  children: number;
  infants: number;
}

/** Every field optional, and the whole object is dropped when nothing was said. */
export interface TripLogistics {
  arrivalTime?: string;
  arrivalPoint?: string;
  departureTime?: string;
  departurePoint?: string;
  stayBooked?: string;
}

/**
 * Separate from `EnergyLevel` on purpose. "How much do you want to walk" is a different question
 * from "can you manage stairs" — using the first as a proxy for the second gave a wheelchair user
 * who describes their energy as high no accommodation at all.
 */
export interface AccessibilityNeeds {
  stepFreeRequired: boolean;
  limitStairs: boolean;
  note: string;
}

export interface CandidatePoi {
  name: string;
  lat: number;
  lon: number;
  kind?: string;
}

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

  group: GroupType;
  groupOther: string;
  party: PartyCounts;
  logistics: TripLogistics;

  purpose: string;
  explorerStyle: ExplorerStyle;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  interests: string[];
  /** In the order starred, because the order *is* the weighting. */
  starredInterests: string[];
  dietary: DietaryNeeds;
  accessibility: AccessibilityNeeds;

  selectedPois: CandidatePoi[];
  customPois: string[];

  /** Comma-separated as typed, split into `UserAnswers.mustInclude`/`.avoid` on submit — plain
   *  strings so the field stays a plain text input, matching how the web wizard holds them. */
  mustInclude: string;
  avoid: string;
  constraintsNote: string;
}

/** The answer tree the generate route stores and the edit loop later reuses. */
export interface UserAnswers {
  purpose?: string;
  explorerStyle?: ExplorerStyle;
  group?: GroupType;
  groupOther?: string;
  party?: PartyCounts;
  logistics?: TripLogistics | null;
  energy?: EnergyLevel;
  crowds?: CrowdPreference;
  budget?: number;
  priorities?: string[];
  topPriorities?: string[];
  selectedPois?: CandidatePoi[];
  customPois?: string[];
  dietary?: DietaryNeeds | null;
  accessibility?: AccessibilityNeeds | null;
  /** Places the traveler named outright, as distinct from an interest tag. Absent means none were
   *  named — never `[]`, which the server's guardrail and prompt would read as a demand for
   *  nothing rather than as silence. */
  mustInclude?: string[];
  /** Hard negative constraints — "no nightclubs", "no seafood". Absent means none were named. */
  avoid?: string[];
  /** Free text — already booked or otherwise fixed. Absent means nothing was said. */
  constraintsNote?: string;
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

/**
 * The categories the place search offers, exactly as `GET /api/place-search` spells them.
 *
 * The same seven on every client — the web's control, the Swift app's chips and these. The list
 * is deliberately short: a picker with forty options is a taxonomy somebody has to learn, and
 * free text covers the rest.
 */
export const PLACE_CATEGORIES = ['cafe', 'restaurant', 'bar', 'sights', 'park', 'shop', 'hotel'] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number] | 'place';

/**
 * One result from the place search. Everything past `category` is provider-dependent.
 *
 * The optional half is OSM's, and it is absent more often than present — measured across 60 named
 * cafes by the web client: street 90%, outdoor seating 81%, phone 52%, hours 36%, website 14%,
 * cuisine 6%. The server has always sent these; this client simply never declared them. They cost
 * nothing to carry — Overpass returns every tag on every element either way — and they are what
 * `describePlace` writes a stop's line from and what the place card is made of.
 *
 * So every reader must look finished with none of them.
 */
export interface FoundPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  address?: string;
  rating?: number;
  /** Raw OSM `opening_hours`, which is a *grammar* and not a clock — "Mo-Sa 07:00-19:00; Su off".
   *  Shown as written, never evaluated: deciding "open now" needs the venue's timezone and a real
   *  parser, and getting it wrong tells somebody a closed door is open. */
  openingHours?: string;
  cuisine?: string;
  website?: string;
  phone?: string;
  /** `true`/`false` where OSM says so, absent where nobody has. The best-covered tag of the set. */
  outdoorSeating?: boolean;
  wheelchair?: 'yes' | 'limited' | 'no';
}

/**
 * A search's answer, with the house distinction intact.
 *
 * `available: false` is **"we could not ask"** — Overpass rate-limited or timed out. An empty
 * `places` with `available: true` is "there are no cafes here". Saying the second when the first
 * is true is a lie about the neighbourhood, which is why the flag exists rather than an empty
 * array standing for both.
 */
export interface PlaceSearchResult {
  provider: 'google' | 'osm';
  places: FoundPlace[];
  available: boolean;
}

/**
 * One turn of the edit conversation.
 *
 * `warnings` and `rejected` ride the turn they belong to rather than living beside the transcript,
 * because a restored conversation has to read the same as a live one — `GET /api/trip-chat` spreads
 * each turn's stored `meta_json` back into this shape for exactly that reason.
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Skill §12 alerts: a day now too long, a leg that no longer fits, a budget overshoot. */
  warnings?: string[];
  /** Ops the applier refused. Rare, and silence here would read as "done" for a turn that partly wasn't. */
  rejected?: string[];
}

/** What `POST /api/trip-edit` answers in chat mode. `itinerary` is the whole updated plan. */
export interface TripEdit {
  itinerary: Itinerary;
  reply: string | null;
  warnings: string[];
  rejected: string[];
  /** 1-based, computed server-side from the ops that actually applied. */
  daysModified: number[];
  /** Both opaque — echoed back untouched on the next turn, never inspected. A null `syncedHash`
   *  is the server saying its picture is stale, and echoing the null is what forces a resync. */
  sessionId: string | null;
  syncedHash: string | null;
}
