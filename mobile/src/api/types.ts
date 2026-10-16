import type { Located } from '@shared/evidence';
import type { HomeCity } from '@shared/travelerProfile';
export type StopCategory = "food" | "entry" | "transit" | "other";

/**
 * How much the plan is allowed to move a stop. Mirrors `src/lib/types.ts` — keep the two in step.
 *
 * `FIXED` is something the traveler booked: a reservation, a train, a timed ticket. It draws a
 * lock, it is exempt from the conflict treatment (it is the thing conflicts are measured
 * *against*), and the server's patch applier refuses to move or drop one.
 *
 * Absent reads as `PREFERRED`, so every trip saved before this existed renders exactly as before.
 */
export type TimeFlexibility = "FIXED" | "PREFERRED";
export type TierId = "budget" | "midrange" | "luxury";
export type TripStatus = "draft" | "saved";

/**
 * Whether a real cost is a commitment or a payment.
 *
 * A booked table at a set price and a ticket already paid for are both *known*, which is what
 * separates them from the planner's estimate — but only one of them has left the account, and a
 * budget that cannot tell them apart cannot answer "how much have I actually spent".
 */
export type CostState = "booked" | "spent";

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
  /** Whether the plan may move this stop. Absent is `PREFERRED`. The traveler sets this by hand
   *  from the stop row; the model only ever writes `FIXED` for something they said was booked. */
  timeFlexibility?: TimeFlexibility;
  /** Whether weather can spoil this stop. Absent means the model did not say — never inferred
   *  from `category`, which cannot tell a covered market from an open one. */
  outdoor?: boolean;
  category: StopCategory;
  actualCost?: number;
  /**
   * How this stop's position came to be what it is — see `Located` in `@shared/evidence`.
   *
   * Absent on every itinerary saved before this existed, and that absence is load-bearing: it
   * means nothing was recorded, which is not the same as a check that ran and missed. The miss
   * writes `"model"`.
   */
  located?: Located;
  /**
   * What `actualCost` is — money committed, or money gone.
   *
   * Absent is a real third answer, not a default. Every figure the web client has ever written
   * carries no kind, and guessing one would invent a fact about somebody's money; such a figure
   * counts as settled and as neither booked nor spent. See `spendSplit`.
   */
  costState?: CostState;
  /**
   * Fields TripMate supplied rather than the traveller, on an imported plan. Drives the hedged
   * wording ("about 10:00"). Absent on generated plans, where every value is the planner's.
   */
  estimated?: ('time' | 'cost' | 'duration' | 'note')[];
  /**
   * Weekdays it's closed, as "Mo"…"Su", from OSM hours. `[]` open every day; null hours unknown
   * or unreadable; absent never looked up. Read by the `closed` guardrail.
   */
  closedDays?: string[] | null;
}

export interface Lodging {
  name: string;
  cost: number;
  note: string;
  actualCost?: number;
  /** See `Stop.costState`. A night's stay is the likeliest thing to be booked. */
  costState?: CostState;
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
  /** A short label for the day's shape ("Old town on foot"), from the sketch stage. Absent on
   *  plans generated before the field existed. */
  theme?: string;
  lodging?: Lodging;
  stops: Stop[];
}

/** A place the traveler already committed to — imported from a screenshot/link/note, or typed. */
export type AnchorPriority = 'must' | 'want';

export interface Anchor {
  name: string;
  lat: number | null;
  lng: number | null;
  priority: AnchorPriority;
  source?: 'import' | 'picked' | 'typed';
}

/** Why an anchor didn't make it into the plan, as the model explained it. */
export interface UnplacedAnchor {
  name: string;
  reason: string;
}

/** What an import could not do: its hours lookup failed, or its cost estimates did. */
export type ImportNote = 'hoursUnchecked' | 'costsUnestimated';

export interface Itinerary {
  tier?: TierId;
  days: DayPlan[];
  /** The traveler's `must`/`want` places, echoed back so the receipt can check coverage. */
  anchors?: Anchor[];
  /** A `must` anchor the model deliberately left out, with its reason. Anything neither here nor
   *  placed was dropped silently. */
  unplaced?: UnplacedAnchor[];
  /** How the plan came to exist. Absent on every plan saved before imports. */
  origin?: 'generated' | 'imported';
  /** What an import could not do, said once on the trip. */
  importNotes?: ImportNote[];
}

export interface TripSummary {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  status?: TripStatus;
  /** When the row was written (ISO). The wall counts a draft's days left from it. */
  createdAt?: string;
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
  /**
   * The destination's IANA zone, e.g. "Europe/Lisbon".
   *
   * Null is a real answer, not a default: a trip saved before this existed, or one whose
   * destination never geocoded, has none. A client must then say nothing about the current time
   * rather than fall back to the device's — measured on the simulator, a device reading 21:07 on
   * Sep 28 is Lisbon 05:07 on Sep **29**, so the device clock gets the wrong *day* of the
   * itinerary, not merely the wrong hour.
   */
  timezone?: string | null;
  /**
   * Whether this trip is currently published under a share link.
   *
   * A boolean, never the token — the screen only needs to know which label to draw, and the
   * token is a capability this app writes to disk in its offline cache. Minting returns the URL
   * to hand straight to the share sheet; asking again is another idempotent POST.
   */
  shared?: boolean;
}

/**
 * A trip somebody shared, as `GET /api/shared/[token]` returns it. Mirrors `SharedTrip` in
 * `src/lib/sharedTrip.ts`: the plan and what is needed to draw it, and none of the sender's own
 * fields (no id, no answers, no chat).
 */
export interface SharedTrip {
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  itinerary: Itinerary;
  timezone: string | null;
  /** The sender's first name, or null when there is none to show. */
  sharedBy: string | null;
}

export type GroupType = "solo" | "couple" | "family_with_kids" | "other";
/** Two answers in one field — superseded by `PacePreference` + `DiscoveryPreference`, and kept
 *  because every stored row and the frozen Swift app carry it. See the server's own note. */
export type ExplorerStyle = "packed" | "relaxed" | "offbeat" | "mixed";

/** How full a day should be. The only thing that sets the pace ceiling. */
export type PacePreference = "relaxed" | "balanced" | "packed";

/** Which places fill it — a taste, and nothing to do with how many. */
export type DiscoveryPreference = "iconic" | "local" | "mix";
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
  /** Legacy, still written beside the pair so older readers keep working — see
   *  `legacyExplorerStyle` on the server. */
  explorerStyle: ExplorerStyle;
  pace?: PacePreference;
  discovery?: DiscoveryPreference;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  priorities: string[];
  topPriorities: string[];
  dietary: DietaryNeeds;
  /** A fact about the traveler, not the trip — kept here for the same reason `dietary` is.
   *  Absent on rows written before the field existed; the server's parser defaults it. */
  accessibility?: AccessibilityNeeds;
  /** Where the traveler sets off from. Set on the welcome and on Profile; absent until then. */
  homeCity?: HomeCity;
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
  /** Whether `budget` is one person's or the whole party's. Absent reads as whole-party,
   *  which is what every reader assumed before the field existed. */
  budgetBasis?: "per_person" | "whole_party";
  /**
   * Set only when a geocode came back a genuine **miss** (404), never when the lookup failed to
   * complete (500). A third-party geocoder's outage is not a claim about what the traveller
   * typed, and neither case ever blocks generating.
   */
  destinationMissed: boolean;
  /**
   * Where the destination actually is, kept so the later steps need not geocode again.
   *
   * Filled from whichever answer arrived first — a picked suggestion carries coordinates, and the
   * blur geocode returns them too. Absent until one of those happens, which is why the arrival
   * points it feeds are a convenience rather than a step anything waits on.
   */
  destinationLat?: number;
  destinationLng?: number;

  group: GroupType;
  groupOther: string;
  party: PartyCounts;
  logistics: TripLogistics;

  purpose: string;
  /** What the traveler answered. The legacy `explorerStyle` is **not** held here — it is derived
   *  from these on submit, so the draft cannot drift from the answer it was derived from. */
  pace: PacePreference;
  discovery: DiscoveryPreference;
  energy: EnergyLevel;
  crowds: CrowdPreference;
  interests: string[];
  /** In the order starred, because the order *is* the weighting. */
  starredInterests: string[];
  dietary: DietaryNeeds;
  accessibility: AccessibilityNeeds;

  selectedPois: CandidatePoi[];
  customPois: string[];
  /** Places found from a screenshot, link or note, plus anything typed straight into a chip. */
  anchors: Anchor[];

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
  pace?: PacePreference;
  discovery?: DiscoveryPreference;
  group?: GroupType;
  groupOther?: string;
  party?: PartyCounts;
  logistics?: TripLogistics | null;
  energy?: EnergyLevel;
  crowds?: CrowdPreference;
  budget?: number;
  /** Whether `budget` is one person's or the whole party's. Absent reads as whole-party,
   *  which is what every reader assumed before the field existed. */
  budgetBasis?: "per_person" | "whole_party";
  priorities?: string[];
  topPriorities?: string[];
  selectedPois?: CandidatePoi[];
  customPois?: string[];
  dietary?: DietaryNeeds | null;
  accessibility?: AccessibilityNeeds | null;
  /** Places found from a screenshot, link or note, plus anything typed straight into a chip.
   *  Absent means none were gathered — the server also still reads the legacy `customPois`. */
  anchors?: Anchor[];
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
   * omitting this creates a *kept* trip and puts an unsaved plan on the trips wall.
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

// --- Chaos in, trip out: importing places from screenshots, links, notes --

export type ImportItem =
  | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string };

/** `POST /api/import`'s answer. A 400/413/429/503 comes back as `{error}` instead — see
 *  `importPlaces`, which folds that into the same return type. */
export interface ImportResult {
  destinationGuess: string | null;
  places: Anchor[];
  unread: { index: number; reason: string }[];
}

// --- The generation stream -------------------------------------------------

export type GenerationStage = 'geocode' | 'context' | 'generate' | 'critique' | 'placing';
export type StageStatus = 'start' | 'done' | 'skipped' | 'failed';

export interface StageEvent {
  stage: GenerationStage;
  status: StageStatus;
}

/** The `sketch` stream event — a day-by-day outline, before any stop is written. */
export interface SketchEvent {
  days: { date: string; theme: string; area: string; anchors: string[] }[];
}

/**
 * The `day-coords` stream event: one day's stops moved to where Overpass found them, keyed by the
 * stop's trimmed name. The model writes coordinates from memory and has been measured 11km out.
 * **`lon`, not `lng`** — alone on this wire, and transcribing it as `lng` reads `undefined`.
 */
export interface DayCoordsEvent {
  dayIndex: number;
  coords: Record<string, { lat: number; lon: number }>;
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
 * **`onPlan` hands the traveller a plan; `onFinal` hands back the reviewed one.** The review pass
 * runs for ~150s after the plan is written, and waiting for it before showing anything would put
 * two and a half minutes of spinner between the traveller and a finished trip. So `onPlan` fires
 * first and the wizard moves on.
 *
 * **This client used to stop reading right there, and that was a real loss rather than a saving.**
 * The review's corrections arrived on the wire and were dropped on the floor: the plan kept on the
 * phone was always the un-reviewed first draft, while the web client — which does read on — kept
 * the corrected one. Measured across the saved trips that produced, every one still carried
 * between 3 and 16 deterministic findings. The server has no cancellation token either
 * (`/api/itinerary`'s `cancel()` says so), so hanging up never saved the work; it only discarded
 * the result of work already paid for.
 *
 * `onFinal` receives the `done` frame, which carries the whole finished `GenerationResult` — the
 * itinerary with the review's day set already swapped in, or the original where the server judged
 * the revision no improvement. So there is nothing to merge here and no separate `revised` handler
 * to keep in step: it is the same shape as `onPlan`, later and better.
 */
export interface GenerateHandlers {
  onStage?: (event: StageEvent) => void;
  onStop?: (event: StreamedStop) => void;
  onSketch?: (event: SketchEvent) => void;
  onDayCoords?: (event: DayCoordsEvent) => void;
  onPlan: (result: GenerationResult) => void;
  /**
   * The reviewed plan, ~150s after `onPlan`.
   *
   * **Fires after the wizard has navigated away, deliberately**, so it must not touch component
   * state or assume anything is still mounted. Its job is to correct what was stored.
   */
  onFinal?: (result: GenerationResult) => void;
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
  /**
   * The scope a *user* turn went out under: a day index, or null for the whole trip.
   *
   * Undefined is a third answer and not the same as null — it is a turn written before the
   * transcript recorded this, and the sheet has to say nothing about those rather than claim
   * they were sent wide.
   */
  scope?: number | null;
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

/** An airport or station near the destination, from `GET /api/arrival-points`. */
export interface ArrivalPoint {
  /** Display name, with the IATA code appended for airports: "Kansai Intl (KIX)". */
  name: string;
  kind: string;
  distanceKm: number;
  /** Sorts before distance. 0 for an international airport, 1 for anything else. */
  tier: number;
  iata: string | null;
}

export type SavedSource = 'screenshot' | 'video' | 'tiktok' | 'youtube' | 'gmaps' | 'url' | 'text' | 'instagram';

/** A place shared into TripMate before planning — see /api/saved-places. */
export interface SavedPlace {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  source: SavedSource;
  url: string | null;
  createdAt: string;
}

export type {
  CompletePlanRequest,
  ImportedDay,
  ImportedPlan,
  ImportedStop,
} from '@shared/importedPlan';

export type { StoryBeat, StoryScript } from '@shared/storyScript';
