"use client";

import { ComponentType, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  MapPin,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Wallet,
} from "lucide-react";
import type { DayEditUpdates } from "@/components/DayHeader";
import FeedbackLoop from "@/components/FeedbackLoop";
import InterestPicker from "@/components/InterestPicker";
import ExplorerStylePicker from "@/components/ExplorerStylePicker";
import GroupTypePicker from "@/components/GroupTypePicker";
import PartyCounter, { DEFAULT_PARTY } from "@/components/PartyCounter";
import SuggestInput, { TIME_OPTIONS, SuggestOption } from "@/components/SuggestInput";
import ChoicePicker, { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import PoiCandidatePicker from "@/components/PoiCandidatePicker";
import { useFocusEdit } from "@/lib/useFocusEdit";
import DestinationSearch from "@/components/DestinationSearch";
import ScrollStory from "@/components/blue-hour/ScrollStory";
import type { PlanPrefill } from "@/components/blue-hour/planExamples";
import DockedPanel from "@/components/DockedPanel";
import ErrorNote from "@/components/ErrorNote";
import OnboardingCard from "@/components/OnboardingCard";
import { backPillClass } from "@/components/BrandMark";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId, TIERS } from "@/lib/tiers";
import {
  CrowdPreference,
  DestinationContext,
  EnergyLevel,
  ExplorerStyle,
  GroupType,
  Itinerary,
  PartyCounts,
  RawFetch,
} from "@/lib/types";
import { CandidatePoi } from "@/lib/pois";
import { useTripCamera } from "@/lib/useTripCamera";
import { useGlobeOnScreen, useMapCamera } from "@/lib/mapCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";
import { formatMoney } from "@/lib/format";
import type { ArrivalPoint } from "@/lib/arrivalPoints";
import { devLabel } from "@/lib/devInspector";
import { clearUnseenDay, markUnseenDays } from "@/lib/unseenChanges";
import type { TravelerProfile, DietaryNeeds } from "@/lib/travelerProfile";
import type { AccessibilityNeeds } from "@/lib/types";
import { readEventStream } from "@/lib/eventStream";
import { STAGE_ORDER, StageEvent } from "@/lib/generationStages";
import type { StageProgress } from "@/lib/generationStages";
import { buildDestinationFacts } from "@/lib/destinationFacts";
import { formatDateRange } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { summarizeDurable } from "@/lib/profileSummary";

/* Five `next/dynamic` boundaries, the same `{ ssr: false }` idiom AppShell uses for the globe.
   None of these renders on the landing step — the landing renders `<ScrollStory>` and nothing
   else — yet all five were parsed at module scope before its first paint, because this module is
   one `"use client"` component covering all three steps of the flow. `ssr: false` costs nothing:
   the initial server render is always `step: "landing"`.

   ItineraryCard is the one that matters. It pulls DayHeader, StopList, BudgetBar, Typewriter and
   icons.tsx behind it — about half of what this module used to parse up front. `DayEditUpdates`
   above is now a `type` import for the same reason: without the keyword it dragged DayHeader and
   framer-motion in for an annotation, defeating this boundary from a different direction.

   Six other pickers stayed static (`InterestPicker`, `ExplorerStylePicker`, `GroupTypePicker`,
   `PoiCandidatePicker`, `FeedbackLoop`, `OnboardingCard`): 1-4KB each, 20KB across six more
   boundaries, which one ItineraryCard boundary already beats. `ChoicePicker` *cannot* be split —
   it exports CROWD_PREFERENCES and ENERGY_LEVELS as values used in the render below.
   `DestinationSearch` is deliberately static too: it is the first field of the plan step,
   rendered in the same tick as the "Plan a trip" click, and the failure mode of a prefetch miss
   there is a form with no destination input. `ScrollStory` static is the whole point. */
const ItineraryCard = dynamic(() => import("@/components/ItineraryCard"), { ssr: false });
const FocusEditMode = dynamic(() => import("@/components/FocusEditMode"), { ssr: false });
const PlaceDetailPanel = dynamic(() => import("@/components/PlaceDetailPanel"), { ssr: false });
const GenerationScreen = dynamic(() => import("@/components/GenerationScreen"), {
  ssr: false,
});

/** Fallback shown only when the thrown error carries no message of its own. */
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** A cancelled fetch, which is a user decision rather than a failure to report back to them. */
function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** How long the loader holds after the run settles, so the marker reaches the pin and the pin
 *  fills before the itinerary takes the screen. Long enough to read as an arrival, short
 *  enough that nobody waiting two minutes notices it as a delay. */
const ARRIVAL_HOLD_MS = 650;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Step = "landing" | "plan" | "result";
/** Only what changes per trip. Explorer style, energy, crowds, tier and priorities live on
 *  /profile and are overridable for one trip via the expander on `basics`. The two screens
 *  between `basics` and `pois` still give the Step 2a fetch time to land before `pois` —
 *  the one fetch-dependent screen — is reached. Keep `pois` last. */
type PlanStep = "basics" | "purpose" | "group" | "pois";
const PLAN_ORDER: PlanStep[] = ["basics", "purpose", "group", "pois"];

// Local calendar date in ISO shape. `toISOString()` would be UTC and roll the date over a
// day early for anyone west of Greenwich in the evening; "sv-SE" formats local time as
// YYYY-MM-DD, which is exactly what <input type="date"> wants.
const todayISO = () => new Date().toLocaleDateString("sv-SE");

const ghostButtonClass =
  "rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg";
// Shared glass-over-globe card treatment — same class the itinerary/detail
// panels use, reused here for consistency across every step of this page.
// `pointer-events-auto` opts back in from AppShell's `pointer-events-none` overlay, which
// exists so the Cesium canvas underneath stays draggable. Every interactive box needs it.
// `is-opaque`: the plan step runs with `globeWanted` false, so there is nothing behind this
// card to frost. It never coexists with a visible globe — submitting unmounts it and boots
// the globe in the same beat. See `.glass-itinerary.is-opaque`.
const cardClass = "glass-itinerary is-opaque pointer-events-auto rounded-2xl p-5 sm:p-6";

// `text-base`, not the 14px body step: 16px is what stops iOS Safari zooming the viewport on
// focus, and it's already a step the system uses (the hero subline).
// Placeholder at /65, up from the /55 the old bordered field used: "Kyoto, Japan" is the only
// thing teaching the `City, Country` shape the geocoder wants, so it has to be readable rather
// than a hint of a hint — and /55 measures 4.23:1 against worst-case bright terrain, under the
// 4.5 floor. /65 puts it at 5.2:1.
const fieldInputClass =
  "w-full bg-transparent text-base outline-none placeholder:font-normal placeholder:text-white/65";
// `::placeholder` never applies to input[type=date] — an empty date cell paints the UA's own
// "mm/dd/yyyy" at the input's own colour and weight, so two of the four cells would read as
// filled while empty. The date inputs take their tone from their own value instead, landing
// on the same treatment the destination placeholder gets.
const fieldFilledTone = "font-medium text-foreground";
const fieldEmptyTone = "font-normal text-white/65";

/**
 * One cell of the trip form's console.
 *
 * The four fields share a single recessed trough instead of each carrying its own box, so what
 * separates one from the next is the hairline *between* them, not a border *around* them. That
 * is both the more modern instrument-like read and the more on-system one: four `bg-white/5`
 * boxes lightened the surface, which the Darken-Never-Lighten Rule forbids, while one darker
 * slate trough inside the 0.62 panel is the One Slate Rule doing exactly what it says.
 *
 * Focus is the cell's whole visual job: the ground steps up, the label turns amber, and a
 * hairline wipes across the bottom edge from the left. That wipe is the only amber that ever
 * appears while typing, and it is the form's one recurring motion.
 */
function Field({
  icon: Icon,
  label,
  delay,
  onActivate,
  grow = "flex-1",
  optional = false,
  children,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  delay: number;
  /** Says so on the label rather than leaving it to be inferred from the absence of a `*`. A cell
   *  that looks exactly like the four required ones beside it reads as a question you are failing
   *  to answer, which is what "Airport or station" was doing to anyone who didn't know theirs. */
  optional?: boolean;
  /** Supplied by the date cells, which open the native picker from a click anywhere in the
   *  cell rather than only on the UA's own (removed) calendar glyph. */
  onActivate?: (cell: HTMLLabelElement, target: EventTarget | null) => void;
  /** Destination spans its own full-width row; the three fixed-width figures below it
   *  split their row evenly. */
  grow?: string;
  children: ReactNode;
}) {
  return (
    <label
      onClick={onActivate ? (e) => onActivate(e.currentTarget, e.target) : undefined}
      style={{ animationDelay: `${delay}ms` }}
      className={`settle-in group relative px-4 py-3 transition-colors duration-300 focus-within:bg-white/[0.05] ${grow} ${
        onActivate ? "cursor-pointer" : "cursor-text"
      }`}
      {...devLabel(`Field.${label}`)}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.025em] text-muted uppercase transition-colors duration-300 group-focus-within:text-accent">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        {label}
        {optional && (
          <span className="font-normal tracking-normal text-white/55 normal-case">optional</span>
        )}
      </span>
      <div className="mt-1.5">{children}</div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-within:scale-x-100"
      />
    </label>
  );
}

/**
 * Opens the native date picker from a click on the cell's chrome — its label, icon or padding.
 * A click on the input itself is left alone: that is how you select a single date segment to
 * type over, and hijacking it would trade a working control for a popup.
 *
 * `showPicker` throws when the call isn't user-activated or the picker is already open. Either
 * way the fallback is the input's own default behaviour, exactly what happened before the cell
 * became clickable.
 */
function openNativePicker(cell: HTMLLabelElement, target: EventTarget | null) {
  const input = cell.querySelector("input");
  if (!input || target === input) return;
  try {
    input.showPicker();
  } catch {
    /* the input's own click handling covers it */
  }
}

/** One Q&A screen: heading, optional subline, body. Every screen after `basics` has the same
 *  shape, so they share this instead of repeating the heading markup six times. */
function Screen({
  name,
  title,
  subtitle,
  children,
}: {
  name: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="value-in" style={{ animationDelay: "80ms" }} {...devLabel(`PlanStep.${name}`)}>
      <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function HomeView({ initialProfile }: { initialProfile: TravelerProfile | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("landing");
  const [planStep, setPlanStep] = useState<PlanStep>("basics");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Every one of these is optional — this is the row nobody has to fill in. Times are "HH:MM"
  // straight from `<input type="time">`; the points are free text and never geocoded.
  const [arrivalTime, setArrivalTime] = useState("");
  const [arrivalPoint, setArrivalPoint] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [departurePoint, setDeparturePoint] = useState("");
  // Read by skill §4e ("already booked beats anything you would recommend"), by
  // `formatTravelerProfile` and by `trip-context.md`. All three were live while nothing
  // collected this, so a booked hotel was being re-chosen by the model every time.
  const [stayBooked, setStayBooked] = useState("");
  // Asked rather than inferred from `energy`. Starts null so an untouched form sends nothing at
  // all — a default-valued object would claim the traveler stated "no needs" when they were never
  // asked, and `deriveMobilityProfile` treats those two cases differently.
  const [accessibility, setAccessibility] = useState<AccessibilityNeeds | null>(null);

  /** Patches one accessibility field, materialising the object on first touch. */
  function setAccess(patch: Partial<AccessibilityNeeds>) {
    setAccessibility((prev) => ({
      stepFreeRequired: false,
      limitStairs: false,
      note: "",
      ...prev,
      ...patch,
    }));
  }
  const [arrivalPointOptions, setArrivalPointOptions] = useState<SuggestOption[]>([]);
  // Where the traveler is flying FROM, not the arrive/depart points above (those are at the
  // destination) — plain free text, collected here and resolved to a real airport server-side
  // (originAirport.ts) rather than through a client-side suggestion dropdown. A dropdown was
  // tried and dropped: it can only filter by substring match against what's already typed, and an
  // airport's OSM name essentially never contains the city name a traveler types ("Boston" vs.
  // "Logan International Airport") — verified live, the list was never non-empty. Unlike
  // `arrivalPoint`, there's no browsable-before-typing state to fall back on here, since nothing
  // is known about the origin until the traveler has already typed into the one field being
  // filtered.
  const [originCity, setOriginCity] = useState("");
  // What the flight will take out of the stated budget, shown before generating rather than
  // explained afterwards on a plan the traveler already waited two minutes for. Null until the
  // four inputs it needs are all present, or when nothing could be priced.
  const [flightCostPreview, setFlightCostPreview] = useState<number | null>(null);
  // True only while the (unavoidably slower) price lookup is in flight, so the caption can say
  // "checking" instead of sitting blank — the gap that read as "the app is stuck" before this.
  const [flightPriceLoading, setFlightPriceLoading] = useState(false);
  // The resolved departure airport, from the SAME two calls (`/api/geocode` then
  // `/api/arrival-points`) the arrive/depart fields already use — which is why those feel
  // fast: neither one chains a `composio` CLI call after the Overpass lookup the way pricing
  // does. Cached per typed city in a ref (not state — it must survive re-renders without
  // re-triggering the effect that reads it) so editing dates or budget after already typing an
  // origin never re-runs this step, only the price lookup that actually needs the new inputs.
  const [resolvedOriginIata, setResolvedOriginIata] = useState<string | null>(null);
  const originAirportCache = useRef<Map<string, string | null>>(new Map());
  const [budget, setBudget] = useState(1000);
  const [interests, setInterests] = useState<string[]>(initialProfile?.priorities ?? []);
  const [starredInterests, setStarredInterests] = useState<string[]>(
    initialProfile?.topPriorities ?? []
  );
  const [destinationMissed, setDestinationMissed] = useState(false);

  // The single "Adjust for this trip" block. One expander, never one per field: the whole
  // point is that the worst case (open it every trip) is still fewer interactions than the
  // seven screens this replaced, and per-field expanders would climb back past that.
  const [adjustOpen, setAdjustOpen] = useState(false);

  // Step 2b — collected alongside the existing basics/interests/style answers, sent to
  // Step 3 as `userAnswers` once generation runs (see `generate()` below).
  const [purpose, setPurpose] = useState("");
  const [explorerStyle, setExplorerStyle] = useState<ExplorerStyle>(
    initialProfile?.explorerStyle ?? "mixed"
  );
  const [group, setGroup] = useState<GroupType>(initialProfile?.group ?? "solo");
  const [groupOther, setGroupOther] = useState("");
  const [party, setParty] = useState<PartyCounts>(DEFAULT_PARTY);
  const [energy, setEnergy] = useState<EnergyLevel>(initialProfile?.energy ?? "moderate");
  const [crowds, setCrowds] = useState<CrowdPreference>(initialProfile?.crowds ?? "mixed");
  const [selectedPois, setSelectedPois] = useState<CandidatePoi[]>([]);
  const [customPois, setCustomPois] = useState<string[]>([]);

  // Durable, and unlike the others it has no wizard screen — /profile is where it's set.
  // Held here only so generate()/refine() can send it.
  const [dietary, setDietary] = useState<DietaryNeeds>(
    initialProfile?.dietary ?? { tags: [], note: "" }
  );

  // Shown once, after the first generation, only when there is no profile yet. Still state,
  // because the onboarding card flips it on save — but no longer `boolean | null`. The null
  // meant "the profile fetch hasn't resolved yet", so the card couldn't flash before it did;
  // the profile now arrives with the first render, leaving no unknown state to model.
  const [hasProfile, setHasProfile] = useState(initialProfile !== null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  // Step 2a — fired fire-and-forget right alongside the existing destination-context
  // warmer, the moment basics are submitted. Never blocks the wizard from advancing;
  // `rawFetchLoading` only gates the POI picker's own loading state.
  const [rawFetch, setRawFetch] = useState<RawFetch | null>(null);
  const [rawFetchLoading, setRawFetchLoading] = useState(false);
  // Parsed festivals/shopping from the same fire-and-forget warmer below. Kept because the
  // model call has already been paid for — the alternative, fetching destination facts when
  // the loader appears, would mean a second model call for data already sitting in cache.
  const [destContext, setDestContext] = useState<DestinationContext | null>(null);
  // Aborts the in-flight generate/refine. A ref, not state: cancelling must not re-render the
  // loader, and nothing renders off this value.
  const abortRef = useRef<AbortController | null>(null);

  /** Stops the run and returns to the form with every answer intact. */
  function cancelGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setRefining(false);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    // Silent on purpose. The user asked for this; an error block telling them the planner
    // didn't finish would be the app reporting their own decision back to them as a fault.
    setError(null);
  }

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  // Id of the LLM pipeline run that produced the current `itinerary` — tracks
  // the most recent generate/refine call so save() can attach it to the
  // trip, letting later place-detail calls append to that same run.
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  // The CLI session the generate call ran in. Handed to the edit chat so refinement continues
  // that same conversation, and saved with the trip so it survives a reload. Null whenever the
  // session is unknown or gone — every consumer treats that as "rebuild the full prompt".
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  // Plays the staggered card reveal + typewriter effect once, right after a fresh
  // generation — cleared the moment a stop is opened so backing out of the detail view
  // doesn't replay the whole entrance again.
  const [revealAnimation, setRevealAnimation] = useState(false);
  /**
   * Whether the plan panel is shut, which is also what puts the globe into the whole-trip
   * overview — hence owned here rather than inside DockedPanel: `ItineraryCard` needs the same
   * boolean to decide whether to frame the active day or the entire trip.
   *
   * Starts true. A finished itinerary opens on its own map, every day clustered and labelled,
   * and the plan is one click behind the panel's arrow.
   */
  const [planCollapsed, setPlanCollapsed] = useState(true);
  /** 0-based days a chat turn changed while the traveler was reading a different one. Owned here
   *  rather than in the card because the chat that produces them lives beside it, not inside it. */
  const [unseenChangedDays, setUnseenChangedDays] = useState<number[]>([]);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>(
    STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const }))
  );
  const [saving, setSaving] = useState(false);
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  // Step 7 edit session. `chatScope` null = closed; { dayIndex: null } = whole trip.
  const focus = useFocusEdit(itinerary);
  const [error, setError] = useState<string | null>(null);

  const {
    destinationCoords,
    flyToDestinationByName,
    flyToDestinationByCoords,
    selectStop,
    closeDetail,
    selectedStop,
    detail,
    detailLoading,
    detailError,
  } = useTripCamera(destination);
  const { resetToHome } = useMapCamera();

  // Mount-only on purpose. The globe lives above the route boundary and never unmounts, so
  // arriving here from /trips ("New trip") would otherwise keep the last trip's route, markers
  // and camera. Stepping plan → landing inside this page doesn't remount, so backToLanding()
  // calls resetToHome() itself.
  useEffect(() => {
    resetToHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warms the chunks the dynamic() boundaries at the top of this file split out, so none of them
  // ever shows its fallback. Fired on leaving the landing, which is the whole point: the landing's
  // first paint must not parse these, and it must not race them against Cesium's own dynamic
  // import either — the globe boots on mount and is orders of magnitude larger than everything
  // here put together. Entering `plan` puts every fetch at least one full step ahead of the
  // render that needs it: the plan step renders none of them, and `result` is a generation away.
  //
  // Plain `import()` rather than next/dynamic's `.preload()`. That method exists at runtime but
  // is absent from next's own `dynamic.d.ts`, so reaching it needs a cast to an undocumented API.
  // These hit the same module registry, fully typed.
  useEffect(() => {
    if (step === "landing") return;
    void import("@/components/GenerationScreen");
    void import("@/components/ItineraryCard");
    void import("@/components/PlaceDetailPanel");
    void import("@/components/FocusEditMode");
  }, [step]);

  // Drives this page's own cosmetics (dark dashboard header/nav once results exist,
  // destination-form positioning) — AppShell's layout itself no longer varies by route/step.
  // Also gates the map control stack via .map-chrome-hidden: hidden on landing (that step is
  // a poster, not a map to read) and on plan (the panel reaches the bottom-left corner below
  // ~1292px), shown on result. Do not "simplify" this to step === "landing".
  // Raised when generation *starts*, not when the result renders. The traveller is then watching
  // a ~150s loader, which makes the 2.3MB Cesium import and the first tiles free — and buys a
  // warm globe for nothing: MapCameraProvider already queued the plan step's destination flight
  // and highway fetch in `pendingRef`/`pendingHighwaysRef`, and those replay on `setViewer`, so
  // the result view opens already framed on the destination with its highways drawn.
  // `refining` is deliberately absent: refine is only reachable from `result`, where this is
  // already true.
  useGlobeOnScreen(generating || step === "result");

  const preResult = step !== "result";

  // Null until both dates are set, so the tier cards show per-day rates rather than a total
  // derived from tripDays' floor-at-1.
  const days = startDate && endDate ? tripDays(startDate, endDate) : null;

  // The cap used to be discoverable only by submitting: the picker happily offered a
  // five-year range and then the form refused it. `tripDays` counts inclusively, so the
  // last allowed end date is start + (MAX_TRIP_DAYS - 1) days. Computed via local calendar
  // components rather than `new Date(startDate).getTime() + …` — that round-trips through
  // UTC-midnight parsing and can drift the result a day either way once re-formatted in a
  // non-UTC zone. Same reasoning as todayISO above.
  const maxEndDate = startDate
    ? (() => {
        const [y, m, d] = startDate.split("-").map(Number);
        return new Date(y, m - 1, d + (MAX_TRIP_DAYS - 1)).toLocaleDateString("sv-SE");
      })()
    : undefined;

  // Derived, not state — there is nothing left to choose. The picker that used to override this
  // is gone: it offered cards priced by `estimateTierTotal`, which on a long trip meant inviting
  // someone with a $1,000 budget to select a ~$6,300 plan (its own OVER_BUDGET_MULTIPLIER guard
  // labelled that mismatch rather than avoiding it).
  //
  // A `tierTouched` ref used to suppress this whenever a saved profile tier existed, on the
  // reasoning that "a saved tier is a stated one, not a guess to be improved on". That depended on
  // a picker existing to state it with; without one it would have frozen a returning traveler's
  // tier for the session no matter what budget they typed. Budget always wins now.
  //
  // Still load-bearing downstream: this feeds `hotelClassForTier`, which is what keeps the real
  // hotel search from returning hostels for a luxury trip.
  const tier: TierId = days === null ? "midrange" : closestTier(budget, days);

  /** Presets from the pill are the common case typed in one tap: Solo is 1, Couple is 2, Family is
   *  2 and a child. Deliberately one-way — the counts never flip the pill back, because a
   *  two-way binding here means picking "Other" and setting 2 adults silently reads as a couple.
   *  "Other" leaves the counts alone: it's the case with no assumable shape. */
  // Airports and stations near wherever the destination resolved to, so the arrive/depart fields
  // can offer real places instead of asking a first-time visitor to know that Kyoto means Kansai.
  //
  // Keyed on the coordinates rather than the typed string: both paths that resolve a destination
  // set them (picking a suggestion, and the geocode on blur), so typing the name without touching
  // the dropdown still works, just a moment later.
  //
  // Fails to an empty list and says nothing. The route already answers 200 with `points: []` on an
  // Overpass outage, and these fields are optional free text — an upstream being down costs the
  // traveler a convenience, not the form. Same reasoning as the geocode miss below.
  useEffect(() => {
    if (!destinationCoords) return;
    let cancelled = false;
    const { lat, lon } = destinationCoords;
    fetch(`/api/arrival-points?lat=${lat}&lon=${lon}`)
      .then((r) => r.json())
      .then((d: { points?: ArrivalPoint[] }) => {
        if (cancelled) return;
        setArrivalPointOptions(
          // The kind belongs in the hint, not welded onto the name. OSM calls Kyoto's main station
          // "Kyoto" — beside a destination also called Kyoto, the bare name says nothing, and
          // appending "Station" ourselves would produce "Gare du Nord Station" elsewhere.
          (d.points ?? []).map((p) => ({
            value: p.name,
            label: p.name,
            hint: `${p.kind === "airport" ? "airport" : "rail"} · ${p.distanceKm}km`,
          }))
        );
      })
      .catch(() => {});
    // Clearing on the way out rather than on the way in covers both orderings: a slow response for
    // a destination the traveler has already changed can't land after the new one's, and the old
    // city's airports don't sit in the list while the new city's are still in flight.
    return () => {
      cancelled = true;
      setArrivalPointOptions([]);
    };
  }, [destinationCoords]);

  // Stage 1 — resolve the departure airport, fast. Depends ONLY on `originCity`: this is the
  // exact same two calls (`/api/geocode` then `/api/arrival-points`) the arrive/depart fields
  // above already make, which is the actual reason those feel snappy — neither one chains a
  // `composio` CLI call after the Overpass lookup. Cached per typed city so retyping the same
  // value (backspace-and-retype, or coming back to an already-resolved city) never re-fetches.
  useEffect(() => {
    const from = originCity.trim();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (from) {
      const key = from.toLowerCase();
      const cached = originAirportCache.current.get(key);
      if (cached !== undefined) {
        // A cache hit is visually instant either way; the 0ms timer exists only so the
        // setState call runs in an async callback rather than synchronously in the effect
        // body, same as the network path below.
        timer = setTimeout(() => {
          if (!cancelled) setResolvedOriginIata(cached);
        }, 0);
      } else {
        timer = setTimeout(async () => {
          try {
            const geoRes = await fetch(`/api/geocode?destination=${encodeURIComponent(from)}`);
            if (!geoRes.ok) throw new Error("geocode failed");
            const geo: { lat?: number; lng?: number } = await geoRes.json();
            if (typeof geo.lat !== "number" || typeof geo.lng !== "number") {
              throw new Error("no match");
            }

            const pointsRes = await fetch(`/api/arrival-points?lat=${geo.lat}&lon=${geo.lng}`);
            const d: { points?: ArrivalPoint[] } = pointsRes.ok ? await pointsRes.json() : {};
            const iata = (d.points ?? []).find((p) => p.kind === "airport")?.iata ?? null;

            originAirportCache.current.set(key, iata);
            if (!cancelled) setResolvedOriginIata(iata);
          } catch {
            originAirportCache.current.set(key, null);
            if (!cancelled) setResolvedOriginIata(null);
          }
        }, 350); // Short: this step alone is the "fast" one, and a keystroke-fast debounce is
        // what makes it feel like the arrive/depart suggestions rather than a separate,
        // slower thing.
      }
    }

    // Clears on the way out — covers an emptied field (nothing scheduled above, so this is the
    // only thing that runs) and a mid-typing keystroke (the stale value from what was typed a
    // moment ago must not linger while a new lookup is pending).
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setResolvedOriginIata(null);
    };
  }, [originCity]);

  // Stage 2 — price it, which is the step that actually needs the `composio` CLI and cannot be
  // made fast the same way. Depends on the RESOLVED iata, not the raw origin text, so editing
  // dates or budget after the airport is already known skips stage 1 entirely and only re-runs
  // this — and `flightPriceLoading` is set the moment this starts, so the wait is visible rather
  // than looking identical to "nothing is happening" for however long the CLI call takes.
  useEffect(() => {
    const to = destination.trim();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (resolvedOriginIata && to && startDate && endDate) {
      timer = setTimeout(async () => {
        if (cancelled) return;
        setFlightPriceLoading(true);
        try {
          const qs = new URLSearchParams({
            iata: resolvedOriginIata,
            destination: to,
            start: startDate,
            end: endDate,
            adults: String(party.adults),
          });
          const res = await fetch(`/api/flight-estimate?${qs}`);
          if (!res.ok) throw new Error("lookup failed");
          const d: { estimate?: { costUsd?: number } | null } = await res.json();
          if (!cancelled) setFlightCostPreview(d.estimate?.costUsd ?? null);
        } catch {
          if (!cancelled) setFlightCostPreview(null);
        } finally {
          if (!cancelled) setFlightPriceLoading(false);
        }
      }, 150); // Short: by the time an iata is resolved, the other three inputs are usually
      // already settled — this only exists to avoid firing mid-keystroke on `destination` or
      // the dates.
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setFlightCostPreview(null);
      setFlightPriceLoading(false);
    };
  }, [resolvedOriginIata, destination, startDate, endDate, party.adults]);

  // "Airport or station" read as a demand for knowledge a first-time visitor doesn't have. Once
  // there is a list to offer, say so; until then, invite rather than ask.
  const arrivalPointPlaceholder =
    arrivalPointOptions.length > 0 ? "Pick or type a place" : "Anywhere you like";

  function pickGroup(next: GroupType) {
    setGroup(next);
    if (next === "solo") setParty({ adults: 1, children: 0, infants: 0 });
    else if (next === "couple") setParty({ adults: 2, children: 0, infants: 0 });
    else if (next === "family_with_kids") setParty({ adults: 2, children: 1, infants: 0 });
  }

  function toggleInterest(tag: string) {
    setInterests((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
    setStarredInterests((prev) => prev.filter((t) => t !== tag || !interests.includes(tag)));
  }

  /** Unselecting a tag must also drop its star, or a starred-but-unselected tag would keep
   *  occupying one of the three slots invisibly. */
  function toggleInterestStar(tag: string) {
    setStarredInterests((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length >= 3
          ? prev
          : [...prev, tag]
    );
  }

  function togglePoi(poi: CandidatePoi) {
    setSelectedPois((prev) =>
      prev.some((p) => p.name === poi.name) ? prev.filter((p) => p.name !== poi.name) : [...prev, poi]
    );
  }

  function addCustomPoi(name: string) {
    setCustomPois((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  function removeCustomPoi(name: string) {
    setCustomPois((prev) => prev.filter((p) => p !== name));
  }

  // One geocode per completed edit of the destination field, fired on blur rather than on a
  // keystroke debounce. The reason is the flights themselves: overlapping 2.5s camera flights
  // visibly lurch through everywhere the prefix matched on the way to the real destination.
  // (It also used to be about the auto-rotate lock — the first keystroke-triggered flight killed
  // the idle spin for the session. That spin is gone, and this reason on its own still holds.)
  const lastFlownRef = useRef("");
  async function flyToTypedDestination() {
    const name = destination.trim();
    if (!name || name === lastFlownRef.current) return;
    lastFlownRef.current = name;
    // Only a genuine geocoding miss earns the "couldn't find that" line. `"unreachable"` means
    // the lookup never completed (Open-Meteo down, connection dropped), which is not a claim we
    // can make about what the user typed — that stays silent and the trip plans regardless.
    setDestinationMissed((await flyToDestinationByName(name)) === "missed");
  }

  function backToLanding() {
    setStep("landing");
    setPlanStep("basics");
    setError(null);
    // Required, not cosmetic: a blur-triggered flight leaves a destination pin dropped and the
    // camera parked on it, and resetToHome is the only thing that clears them.
    resetToHome();
  }

  /** Cross-field rules the browser's own constraint validation can't express. */
  function validate(): string | null {
    if (endDate < startDate) return "End date must be on or after the start date.";
    if (isTripTooLong(startDate, endDate)) {
      return `Trips over ${MAX_TRIP_DAYS} days aren't supported — please choose a shorter date range.`;
    }
    return null;
  }

  /** The Step 2b answers, in one place — generation, save and the edit loop must all see the
   *  identical profile or the edit loop starts re-asking what planning already knew. */
  function currentAnswers() {
    return {
      purpose,
      explorerStyle,
      group,
      groupOther,
      party,
      energy,
      crowds,
      budget,
      priorities: interests,
      topPriorities: starredInterests,
      selectedPois,
      customPois,
      // Sent as-is; `sanitizeLogistics` on the server collapses an all-empty object to null, so
      // a traveler who skipped the row gets the prompt they'd have got before it existed.
      logistics: {
        arrivalTime: arrivalTime || null,
        arrivalPoint: arrivalPoint || null,
        departureTime: departureTime || null,
        departurePoint: departurePoint || null,
        stayBooked: stayBooked || null,
        originCity: originCity || null,
      },
      accessibility,
    };
  }

  /**
   * Posts to /api/itinerary with `?stream=1` and updates `stages` as real progress frames
   * arrive via readEventStream. Falls back to the plain (non-streaming) POST if the stream
   * never opens at all — a network error or non-200 status before any bytes arrive. Once
   * streaming has genuinely started, a mid-generation failure is never retried: it would
   * spend another two minutes and a second pair of model calls with no visibility to the
   * traveler that it's happening again.
   */
  async function runStreamed<T>(body: Record<string, unknown>): Promise<T> {
    // One controller per run, so Cancel aborts the in-flight request rather than leaving it
    // running invisibly while the UI pretends it stopped. Replaced (not reused) on every run.
    const controller = new AbortController();
    abortRef.current = controller;

    const plainFallback = async (): Promise<T> => {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate itinerary");
      return data as T;
    };

    let res: Response;
    try {
      res = await fetch("/api/itinerary?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      // An abort must not fall through to the non-streaming retry — that would silently start
      // the whole two-minute call again immediately after the user asked it to stop.
      if (controller.signal.aborted) throw e;
      return plainFallback();
    }

    if (!res.ok || !res.body) {
      return plainFallback();
    }

    let result: T | null = null;
    let failure: string | null = null;
    await readEventStream(res.body, (event, data) => {
      if (event === "stage") {
        const parsed = JSON.parse(data) as StageEvent;
        setStages((prev) =>
          prev.map((s) => (s.stage === parsed.stage ? { ...s, status: parsed.status } : s))
        );
      } else if (event === "done") {
        result = JSON.parse(data) as T;
      } else if (event === "error") {
        failure = (JSON.parse(data) as { error: string }).error;
      }
    });

    if (failure) throw new Error(failure);
    if (!result) throw new Error("The planner didn't finish. Try generating again.");
    return result;
  }

  async function generate() {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setGenerating(true);
    setError(null);
    // Back to the map for the new trip. Without this, a traveler who opened the plan on their
    // last result, backed out and generated again would land straight in the panel — this page
    // never unmounts between the two, so the collapse state would otherwise carry over.
    setPlanCollapsed(true);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    try {
      const data = await runStreamed<{
        itinerary: Itinerary;
        runId?: string | null;
        sessionId?: string | null;
      }>({
        destination,
        startDate,
        endDate,
        budget,
        tier,
        preferences: { tags: interests, vibe: null },
        userAnswers: currentAnswers(),
        dietary,
      });
      // Let the arrival land before swapping surfaces. Without this the loader unmounts the
      // instant the itinerary resolves, so the marker never reaches the pin and the whole
      // two-minute wait ends on a hard cut. Peak-end weights these few hundred milliseconds
      // far more heavily than the middle minute, and they used to be spent on nothing.
      // ItineraryCard's own staggered reveal takes over from here.
      await settle(ARRIVAL_HOLD_MS);
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
      setLastSessionId(data.sessionId ?? null);
      setRevealAnimation(true);
      setStep("result");

      // Deliberately no profile write here. The wizard's "Adjust for this trip" values are a
      // per-trip override, and writing them back would silently make one unusual trip the
      // traveler's permanent default — the bug this codebase already hit twice with `tier`.
      // /profile and the onboarding card are the only writers.
    } catch (e) {
      // A cancel arrives here as an AbortError. It is not a failure and must not be reported
      // as one — cancelGeneration has already reset the UI.
      if (!isAbort(e)) {
        setError(errorMessage(e, "We couldn't build your itinerary. Try generating again."));
      }
    } finally {
      setGenerating(false);
    }
  }

  async function refine(feedback: string) {
    setRefining(true);
    setError(null);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    try {
      const data = await runStreamed<{
        itinerary: Itinerary;
        runId?: string | null;
        sessionId?: string | null;
      }>({
        destination,
        startDate,
        endDate,
        budget,
        previousItinerary: itinerary,
        feedback,
        userAnswers: currentAnswers(),
        dietary,
      });
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
      setLastSessionId(data.sessionId ?? null);
    } catch (e) {
      if (!isAbort(e)) {
        setError(errorMessage(e, "We couldn't apply that change. Your current plan is unchanged."));
      }
    } finally {
      setRefining(false);
    }
  }

  // Pre-save editing is local-state only — there's no trip row to persist to
  // until save() runs, so these just mutate the in-progress itinerary.
  /** A hand-rearranged itinerary from the card's drag-and-drop. `moveStop` has already re-timed the
   *  affected days, so there is nothing to recompute here — and nothing to persist yet, same as the
   *  inline day edits.
   *
   *  This wiring is why the feature is reachable at all. `ItineraryCard` renders `SplitEditor`
   *  itself, but `onItineraryChange` is optional and a caller that omits it gets an editor whose
   *  drops, edits and deletes all go nowhere. The handler lived in `page.tsx` until that file was
   *  split into this one, so the merge that brought the board across would otherwise have landed
   *  it dead. Now carries every edit the split editor makes, not only drags — the name is older
   *  than its job. */
  function handleRearrange(next: Itinerary) {
    setRevealAnimation(false);
    setItinerary(next);
  }

  function handleEditDay(dayIndex: number, updates: DayEditUpdates) {
    if (!itinerary) return;
    const updated: Itinerary = structuredClone(itinerary);
    Object.assign(updated.days[dayIndex], updates);
    setItinerary(updated);
  }



  async function save() {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          startDate,
          endDate,
          budget,
          itinerary,
          runId: lastRunId,
          chatSessionId: lastSessionId,
          userAnswers: currentAnswers(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save trip");
      router.push(`/trip/${data.id}`);
    } catch (e) {
      setError(errorMessage(e, "We couldn't save this trip. Try again."));
      setSaving(false);
    }
  }

  // Everything the loader shows while an itinerary is being written, assembled from data this
  // page already holds. Deliberately no model call: `runClaude` spends almost all of its wall
  // clock waiting for a first token, so trivia fetched that way would arrive after the plan it
  // was meant to fill the time for.
  const wikiExtract = usePlacePhoto(destination, "extract");
  const destinationFacts = useMemo(
    () =>
      buildDestinationFacts({
        destination,
        rawFetch,
        context: destContext,
        wikiExtract,
        viewerUtcOffsetMinutes: -new Date().getTimezoneOffset(),
      }),
    [destination, rawFetch, destContext, wikiExtract]
  );

  /**
   * Opens the wizard, optionally filled in from a featured card.
   *
   * Only the six fields a card can honestly speak for are written. Everything else — energy,
   * crowds, interests, explorer style — keeps whatever the traveller's saved profile put there,
   * because a marketing example has no business overwriting a stated preference.
   *
   * `tier` and `group` are derived rather than carried: `closestTier` already owns the
   * budget-to-tier mapping the tier cards use, and re-stating it in the card data would be a second
   * copy to keep in sync. Same for the group — it falls out of the party counts.
   *
   * Dates arrive already rolled forward to the next occurrence of the card's season, so they can
   * never be behind the `min={todayISO()}` the date inputs enforce.
   *
   * Deliberately *not* geocoded here. Geocoding happens on the destination field's blur, and a
   * programmatic set fires no blur — but these destinations are curated and real, the globe does not
   * boot on this step anyway, and a missed geocode is non-blocking by design. The traveller
   * touching the field is what resolves it, exactly as when they type their own.
   */
  function startPlanning(prefill?: PlanPrefill) {
    if (prefill) {
      setDestination(prefill.destination);
      setStartDate(prefill.startDate);
      setEndDate(prefill.endDate);
      setBudget(prefill.budgetUsd);
      setParty({ adults: prefill.adults, children: prefill.children, infants: 0 });
      setGroup(
        prefill.children > 0 ? "family_with_kids" : prefill.adults === 1 ? "solo" : "couple"
      );
    }
    // Always the first sub-step, even fully prefilled: the card is a suggestion and the traveller
    // should see what it filled in before it prices anything.
    setPlanStep("basics");
    setStep("plan");
  }

  return (
    <main
      // pt-[calc(var(--nav-h)+1.25rem)]: clearance for the fixed glass navbar (AppShell
      // renders Navbar on every route). The Blue Hour scene tokens and display face are
      // scoped to the landing step alone, not to every pre-result step the way the
      // standalone Blue Hour build had it: the plan step here is this app's own card
      // form, which carries its own type and palette and reads wrong under the scene
      // hues. The extra top padding is what ScrollStory's negative top margin cancels —
      // see the note on that component's wrapper.
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)] ${!preResult ? "dashboard-page" : "map-chrome-hidden"} ${
        step === "landing" ? "blue-hour-scene" : ""
      }`}
    >
      {/* Gated here rather than left to the component's own `if (!active) return null`. It is
          behind a dynamic() boundary now, and an unconditionally-rendered dynamic component
          fetches its chunk on first render — i.e. on the landing, which is the one thing the
          boundary exists to prevent. */}
      {(generating || refining) && (
        <GenerationScreen
          mode={refining ? "refine" : "generate"}
          stages={stages}
          facts={destinationFacts}
          destination={destination}
          dateRange={startDate && endDate ? formatDateRange(startDate, endDate) : null}
          tripDays={days}
          tierName={TIERS.find((t) => t.id === tier)?.name ?? null}
          budget={budget}
          rawFetch={rawFetch}
          onCancel={cancelGeneration}
        />
      )}

      {/* The Blue Hour scroll story: a photo hero with no CTA, an image row and a mechanism
          explainer, and "Plan a trip" uncovered only at the end. It owns full-bleed sections
          with real scroll height, so it replaces the single centered hero this step used to
          be — but it hands off to the same setStep("plan"), which is this app's own multi-step
          form rather than the standalone build's one-card console. */}
      {step === "landing" && <ScrollStory onPlan={startPlanning} />}

      {/* Form and tier picker merged into one card: the dates and budget are what price the
          tiers, so splitting them across two steps meant choosing a style blind. One <form>
          around both halves so the browser's own constraint validation gates the submit
          button that now sits below the tier cards. */}
      {step === "plan" && !generating && (
        <div className="flex flex-1 items-center justify-center">
          {/* 84rem, not the 64rem this was. A rem cap is the right shape here because the root is
              fluid - the ceiling scales with the design rather than pinning it - but 64rem still left
              320px of dead slate either side at 1920 and 640px at 2560, next to a landing that now
              runs edge to edge. Not removed outright, unlike the photo grid: this is a form, and a
              four-cell field row spanning 1900px puts Back and Next at opposite ends of the screen
              and stops them reading as a pair. */}
          <div className="w-full max-w-[84rem] space-y-4">
            {/* Same hero-rise as the landing block, so the step reads as one move in both
                directions rather than an instant swap forward and an animated one back. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (planStep === "basics") {
                  const invalid = validate();
                  if (invalid) {
                    setError(invalid);
                    return;
                  }
                  setError(null);
                  // Fire-and-forget: warms the destination_context cache (festivals/safety/
                  // shopping/trends) while the user answers the next two steps, so the
                  // generate call later doesn't pay for that LLM round trip on top of its own.
                  fetch("/api/destination-context", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ destination, startDate, endDate }),
                  })
                    // Reading the body is new; firing it is not. The route already made this
                    // call to warm the cache, so keeping its result costs nothing and gives
                    // the generation loader real festival/shopping facts to show.
                    .then((r) => r.json())
                    .then((d) => setDestContext(d.context ?? null))
                    .catch(() => {});
                  // Step 2a, run the same way: fired now so the bundle (weather, holidays,
                  // candidate POIs, ...) is ready well before the profile step's POI picker
                  // needs it. Never awaited here — it must not block advancing the wizard.
                  setRawFetchLoading(true);
                  fetch("/api/trip-fetch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ destination, startDate, endDate }),
                  })
                    .then((r) => r.json())
                    .then((data) => setRawFetch(data.rawFetch ?? null))
                    .catch(() => {})
                    .finally(() => setRawFetchLoading(false));
                  setPlanStep("purpose");
                  return;
                }
                const at = PLAN_ORDER.indexOf(planStep);
                if (at < PLAN_ORDER.length - 1) {
                  setPlanStep(PLAN_ORDER[at + 1]);
                  return;
                }
                generate();
              }}
              className={`hero-rise ${cardClass}`}
            >
              {planStep === "basics" && (
                <>
                  {/* One instrument, not four widgets. The trough is `--surface-deep` at a lower
                      alpha than the panel around it, so it reads as recessed into the glass rather
                      than stacked on top of it, and the cells are separated by the divider between
                      them.
                      NOT `overflow-hidden`: the Destination cell's autocomplete dropdown floats
                      below this whole row, and this console is short enough (one row of fields)
                      that the dropdown would get clipped at its bottom edge otherwise. The rounded
                      corners don't need the clip — nothing in here has a background/transform that
                      would poke past them (contrast the hero-photo bands elsewhere, which do).
                      Destination gets its own full-width row rather than sharing one with the three
                      fixed-width figures — it's the field the geocoder dropdown hangs off of, and
                      splitting it out is what lets that dropdown span the whole console instead of
                      a cramped `flex-[1.5]` slice of it. */}
                  <div
                    className="field-console flex flex-col divide-y divide-white/10 overflow-visible rounded-2xl border border-white/10 bg-surface-deep/50"
                    {...devLabel("PlanStep.Basics")}
                  >
                    <Field icon={MapPin} label="Destination" delay={80} grow="w-full">
                      <DestinationSearch
                        variant="bare"
                        value={destination}
                        onQueryChange={(v) => {
                          setDestination(v);
                          setDestinationMissed(false);
                        }}
                        onBlur={flyToTypedDestination}
                        onPick={(s) => {
                          lastFlownRef.current = s.name;
                          flyToDestinationByCoords(s.lat, s.lon, s.name);
                        }}
                        placeholder="Kyoto, Japan"
                      />
                    </Field>
                    {/* Stacks vertically below `md`, where three cells in a row would each be
                        narrower than the date they have to hold. */}
                    <div className="flex flex-col divide-y divide-white/10 md:flex-row md:divide-x md:divide-y-0">
                      <Field
                        icon={CalendarDays}
                        label="Start"
                        delay={140}
                        onActivate={openNativePicker}
                      >
                        <input
                          required
                          type="date"
                          min={todayISO()}
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className={`${fieldInputClass} tabular-nums ${startDate ? fieldFilledTone : fieldEmptyTone}`}
                        />
                      </Field>
                      <Field
                        icon={CalendarCheck}
                        label="End"
                        delay={200}
                        onActivate={openNativePicker}
                      >
                        <input
                          required
                          type="date"
                          min={startDate || todayISO()}
                          max={maxEndDate}
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className={`${fieldInputClass} tabular-nums ${endDate ? fieldFilledTone : fieldEmptyTone}`}
                        />
                      </Field>
                      <Field icon={Wallet} label="Total budget" delay={260}>
                        {/* The `$` belongs in the field, not parenthesised in the label — budget is
                            the product's whole mechanism, so it should read as a figure being
                            entered rather than as a number with a unit noted elsewhere. */}
                        <div className="flex items-baseline gap-1">
                          <span className="text-base font-medium text-muted">$</span>
                          {/* Clearing the field used to snap the value back to a literal "0" under
                              the cursor, because Number("") is 0. 0 renders as empty instead, and
                              min={1} keeps it from ever submitting. */}
                          <input
                            required
                            type="number"
                            min={1}
                            value={budget === 0 ? "" : budget}
                            onChange={(e) => setBudget(Number(e.target.value))}
                            className={`${fieldInputClass} tabular-nums ${budget === 0 ? fieldEmptyTone : fieldFilledTone}`}
                          />
                        </div>
                        {/* Until this line existed, picking two dates never told you how long the
                            trip was — the day count was computed for the tier cards and never
                            shown. Saying what the budget buys per day answers both at once, and
                            it's the division the traveler was going to do anyway. */}
                        {days !== null && budget > 0 && (
                          <div
                            key={`${budget}-${days}`}
                            className="value-in mt-0.5 text-xs tabular-nums text-muted"
                          >
                            {formatMoney(Math.round(budget / days))}/day for {days}{" "}
                            {days === 1 ? "day" : "days"}
                          </div>
                        )}
                        {/* Under the budget field because this is the field it modifies: the plan
                            is written against the budget MINUS real airfare, and without saying so
                            here the traveler only ever discovers it by finding a smaller total
                            than they typed, two minutes later, with nothing accounting for the
                            gap. */}
                        {flightPriceLoading && flightCostPreview === null && budget > 0 && (
                          // The one thing missing before: total silence for however long the
                          // price lookup takes, which is exactly what read as "the app is stuck".
                          <div className="value-in mt-0.5 text-xs text-muted">
                            Checking flight prices…
                          </div>
                        )}
                        {flightCostPreview !== null && budget > 0 && (
                          <div
                            key={`flight-${flightCostPreview}-${budget}`}
                            className="value-in mt-0.5 text-xs text-muted"
                          >
                            <span className="tabular-nums">
                              ≈ {formatMoney(flightCostPreview)}
                            </span>{" "}
                            of this goes to flights
                            {flightCostPreview < budget && (
                              <>
                                , leaving{" "}
                                <span className="tabular-nums">
                                  {formatMoney(budget - flightCostPreview)}
                                </span>{" "}
                                to plan with
                              </>
                            )}
                          </div>
                        )}
                      </Field>
                    </div>

                    {/* Optional, and its own row rather than three more cells crushed into the one
                        above. A traveler landing at 20:15 was getting a full first day planned
                        for them; a traveler landing at an airport was getting a first stop
                        downtown. */}
                    <div className="flex flex-col divide-y divide-white/10 md:flex-row md:divide-x md:divide-y-0">
                      <Field icon={Plane} label="Flying from" delay={300} optional>
                        <SuggestInput
                          freeText
                          ariaLabel="City you're flying from"
                          value={originCity}
                          onChange={setOriginCity}
                          options={[]}
                          placeholder="Where you're flying from"
                          className="flex-1"
                          inputClassName={`${fieldInputClass} ${originCity ? fieldFilledTone : fieldEmptyTone}`}
                        />
                      </Field>
                      <Field icon={PlaneLanding} label="Arrive" delay={320} optional>
                        <div className="flex items-baseline gap-2">
                          <SuggestInput
                            ariaLabel="Arrival time on day 1"
                            value={arrivalTime}
                            onChange={setArrivalTime}
                            options={TIME_OPTIONS}
                            placeholder="Time"
                            className="w-[6.5rem] shrink-0"
                            inputClassName={`w-full bg-transparent text-base tabular-nums outline-none placeholder:font-normal placeholder:text-white/65 ${arrivalTime ? fieldFilledTone : fieldEmptyTone}`}
                          />
                          <SuggestInput
                            freeText
                            ariaLabel="Where you arrive"
                            value={arrivalPoint}
                            onChange={setArrivalPoint}
                            options={arrivalPointOptions}
                            placeholder={arrivalPointPlaceholder}
                            className="flex-1"
                            inputClassName={`${fieldInputClass} ${arrivalPoint ? fieldFilledTone : fieldEmptyTone}`}
                          />
                        </div>
                      </Field>
                      <Field icon={PlaneTakeoff} label="Depart" delay={380} optional>
                        <div className="flex items-baseline gap-2">
                          <SuggestInput
                            ariaLabel="Departure time on the last day"
                            value={departureTime}
                            onChange={setDepartureTime}
                            options={TIME_OPTIONS}
                            placeholder="Time"
                            className="w-[6.5rem] shrink-0"
                            inputClassName={`w-full bg-transparent text-base tabular-nums outline-none placeholder:font-normal placeholder:text-white/65 ${departureTime ? fieldFilledTone : fieldEmptyTone}`}
                          />
                          <SuggestInput
                            freeText
                            ariaLabel="Where you depart from"
                            value={departurePoint}
                            onChange={setDeparturePoint}
                            options={arrivalPointOptions}
                            placeholder={arrivalPointPlaceholder}
                            className="flex-1"
                            inputClassName={`${fieldInputClass} ${departurePoint ? fieldFilledTone : fieldEmptyTone}`}
                          />
                        </div>
                      </Field>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-surface-deep/50 px-4 py-3">
                    <label className="text-xs font-medium text-muted">Already booked or fixed</label>
                    <input
                      type="text"
                      value={stayBooked}
                      placeholder="Where you're staying, if it's booked"
                      onChange={(e) => setStayBooked(e.target.value)}
                      className={`${fieldInputClass} ${stayBooked ? fieldFilledTone : fieldEmptyTone}`}
                    />
                  </div>

                  <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-surface-deep/50 px-4 py-3">
                    <label className="text-xs font-medium text-muted">Getting around</label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={accessibility?.stepFreeRequired ?? false}
                        onChange={(e) => setAccess({ stepFreeRequired: e.target.checked })}
                        className="accent-accent"
                      />
                      I need step-free routes throughout
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={accessibility?.limitStairs ?? false}
                        onChange={(e) => setAccess({ limitStairs: e.target.checked })}
                        className="accent-accent"
                      />
                      Avoid stairs and steep climbs where possible
                    </label>
                    <input
                      type="text"
                      value={accessibility?.note ?? ""}
                      placeholder="Anything else we should plan around"
                      onChange={(e) => setAccess({ note: e.target.value })}
                      className={`${fieldInputClass} ${accessibility?.note ? fieldFilledTone : fieldEmptyTone}`}
                    />
                  </div>

                  {/* The collapsed state names the remembered values rather than hiding behind
                      a bare "Adjust" link — a traveler who cannot see these has no way to know
                      the app applied them, and a hidden control reads as the app having
                      forgotten. Everything durable lives in this one block: no pagination, no
                      second expander. */}
                  <div className="mt-3 rounded-2xl border border-white/10 bg-surface-deep/50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted">
                        {summarizeDurable({
                          explorerStyle,
                          energy,
                          crowds,
                          topPriorities: starredInterests,
                        })}
                      </p>
                      <button
                        type="button"
                        aria-expanded={adjustOpen}
                        onClick={() => setAdjustOpen((v) => !v)}
                        className="shrink-0 text-xs font-medium text-accent underline-offset-4 hover:underline"
                      >
                        {adjustOpen ? "Done" : "Adjust for this trip"}
                      </button>
                    </div>

                    {adjustOpen && (
                      <div className="mt-4 space-y-5 border-t border-white/10 pt-4">
                        <p className="text-xs text-muted">
                          Changes here apply to this trip only. Your saved profile is untouched —
                          edit it on the <Link href="/profile" className="text-accent underline-offset-4 hover:underline">profile page</Link>.
                        </p>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">Explorer style</label>
                          <ExplorerStylePicker selected={explorerStyle} onSelect={setExplorerStyle} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">How much walking suits you</label>
                          <ChoicePicker name="energy" options={[...ENERGY_LEVELS]} selected={energy} onSelect={setEnergy} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">Crowds</label>
                          <ChoicePicker name="crowds" options={[...CROWD_PREFERENCES]} selected={crowds} onSelect={setCrowds} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">Style and budget</label>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted">What matters most</label>
                          <InterestPicker
                            selected={interests}
                            starred={starredInterests}
                            onToggle={toggleInterest}
                            onToggleStar={toggleInterestStar}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Deliberately not the red error block: an Open-Meteo miss only costs the map
                      flight and the weather lookup. The itinerary still generates, so blocking on
                      a third-party geocoder would turn their outage into "the app is broken". */}
                  {/* aria-live rather than role="alert": this resolves asynchronously after a
                      geocode the user didn't ask for and doesn't block anything, so it should
                      wait its turn rather than interrupt. */}
                  {/* The live region is always mounted and collapses to nothing when empty —
                      a region that appears at the same moment as its message is announced
                      unreliably, because the assistive tech never saw it go from empty to full. */}
                  <div aria-live="polite">
                    {destinationMissed && (
                      <p className="value-in mt-2.5 text-xs text-muted">
                        Couldn&apos;t find that on the map — we&apos;ll still plan it.
                      </p>
                    )}
                  </div>
                </>
              )}

              {planStep === "purpose" && (
                <Screen
                  name="Purpose"
                  title="What's the occasion?"
                  subtitle="Optional — a birthday, a first visit or a workation all change what fits."
                >
                  <input
                    type="text"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="e.g. anniversary trip, first time in Japan, work + play"
                    className="w-full rounded-full bg-white/10 px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </Screen>
              )}

              {planStep === "group" && (
                <Screen
                  name="Group"
                  title="Who's going?"
                  subtitle="This changes trip to trip, so we ask every time."
                >
                  <div className="space-y-4">
                    <GroupTypePicker selected={group} onSelect={pickGroup} />
                    {group === "other" && (
                      <input
                        type="text"
                        value={groupOther}
                        onChange={(e) => setGroupOther(e.target.value)}
                        placeholder="e.g. five college friends, work offsite, three generations"
                        aria-label="Who's going"
                        className="value-in w-full rounded-full bg-white/10 px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                      />
                    )}
                    {/* Shown for every group, not just families: a party of six friends is
                        exactly the case where headcount changes the lodging and the table. */}
                    <div className="border-t border-white/10 pt-3">
                      <PartyCounter value={party} onChange={setParty} />
                    </div>
                  </div>
                </Screen>
              )}

              {/* Last on purpose: the only screen that needs Step 2a's fetch, by which point the
                  three preceding screens have given it time to land. Leaving it empty is normal —
                  the profile above is what selects stops. */}
              {planStep === "pois" && (
                <Screen
                  name="Pois"
                  title="Anywhere you already know you want to go?"
                  subtitle="Optional — skip this and we'll choose every stop for you."
                >
                  <PoiCandidatePicker
                    pois={rawFetch?.candidatePois.pois ?? []}
                    loading={rawFetchLoading}
                    available={rawFetch?.candidatePois.available ?? false}
                    selected={selectedPois}
                    onToggle={togglePoi}
                    customPois={customPois}
                    onAddCustom={addCustomPoi}
                    onRemoveCustom={removeCustomPoi}
                  />
                </Screen>
              )}

              <div
                className="value-in mt-6 flex items-center justify-between border-t border-card-border pt-5"
                style={{ animationDelay: "440ms" }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const at = PLAN_ORDER.indexOf(planStep);
                    if (at === 0) backToLanding();
                    else setPlanStep(PLAN_ORDER[at - 1]);
                  }}
                  className={ghostButtonClass}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="group inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98]"
                >
                  {planStep === PLAN_ORDER[PLAN_ORDER.length - 1] ? "Generate itinerary" : "Next"}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
                    strokeWidth={2.25}
                  />
                </button>
              </div>
            </form>

            {/* This one *is* an interruption — the user pressed Generate and nothing
                happened, and focus stays on the button they just pressed. */}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </div>
      )}

      {step === "result" && itinerary && (
        <DockedPanel
          collapsible
          busy={refining}
          wide={!!focus.target}
          collapsed={planCollapsed}
          onCollapsedChange={setPlanCollapsed}
          // What the capsule carries while the panel is shut — the trip at a glance, so
          // "which day was I reading" survives a look at the map. Pre-save there is no trip
          // row yet, so this reads the form's own destination, the way the arrange board does.
          capsule={
            destination
              ? {
                  title: destination,
                  subtitle: itinerary?.days.length
                    ? `${itinerary.days.length} ${itinerary.days.length === 1 ? "day" : "days"}`
                    : undefined,
                  step: itinerary?.days.length ? `Day ${activeDayIndex + 1}` : undefined,
                }
              : undefined
          }
        >
          <div className="space-y-6" {...devLabel("ResultPanel")}>
            {/* refine()/save() can fail after the card is already showing — this is the
                only place either error would otherwise have nowhere to render. */}
            {error && <ErrorNote>{error}</ErrorNote>}

            {/* Kept mounted (not unmounted) behind the stop-detail panel below, so the
                active day, this panel's scroll position and the stop tour's interval all
                survive the round trip instead of resetting when ItineraryCard remounts. */}
            <div className={selectedStop ? "hidden" : "space-y-6"}>
              {/* Refine rides the row the Back pill already owns rather than sitting alone at
                  the foot of the panel, where it landed under the floating trace button and
                  behind a full scroll of a long trip. */}
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={backToLanding} className={backPillClass}>
                  <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
                  Back
                </button>
                {!focus.target && (
                  <button
                    type="button"
                    onClick={() => focus.open(0, "trip")}
                    className={ghostButtonClass}
                  >
                    Refine with AI
                  </button>
                )}
              </div>
              {/* Focus Mode takes over the card while editing a day. */}
              {focus.target && focus.draft && (
                <FocusEditMode
                  trip={{ id: "", destination, startDate, endDate, budget }}
                  userAnswers={currentAnswers()}
                  draft={focus.draft}
                  dayIndex={focus.target.dayIndex}
                  scope={focus.target.scope}
                  sessionId={lastSessionId}
                  dirty={focus.dirty}
                  onDaysModified={(days) =>
                    setUnseenChangedDays((prev) =>
                      markUnseenDays(days, focus.target?.dayIndex ?? activeDayIndex, prev)
                    )
                  }
                  onDraftChange={focus.applyDraft}
                  onCancel={focus.cancel}
                  onSave={() => {
                    const committed = focus.save();
                    if (committed) setItinerary(committed);
                  }}
                />
              )}

              {!focus.target && hasProfile === false && !onboardingDismissed && (
                <OnboardingCard
                  answers={{
                    group,
                    explorerStyle,
                    energy,
                    crowds,
                    priorities: interests,
                    topPriorities: starredInterests,
                  }}
                  onSaved={(dietary) => {
                    setHasProfile(true);
                    setOnboardingDismissed(true);
                    setDietary(dietary);
                  }}
                  onDismiss={() => setOnboardingDismissed(true)}
                />
              )}

              {!focus.target && (
                <ItineraryCard
                  itinerary={itinerary}
                  budget={budget}
                  destination={destination}
                  onSelectStop={(stop) => {
                    setRevealAnimation(false);
                    selectStop(stop);
                  }}
                  editable
                  activeDayIndex={activeDayIndex}
                  unseenChangedDays={unseenChangedDays}
                  onActiveDayChange={(next) => {
                    setActiveDayIndex(next);
                    // Looking at the day is what marks it read.
                    setUnseenChangedDays((prev) => clearUnseenDay(prev, next));
                  }}
                  onEditDay={handleEditDay}
                  // Same window "Refine with AI" opens, just starting on the day whose icon was
                  // clicked: one chat surface with day navigation, rather than a second
                  // day-locked variant that looked identical but couldn't reach other days.
                  onChatDay={(dayIndex) => focus.open(dayIndex, "trip")}
                  onItineraryChange={handleRearrange}
                  // The board only needs a name, a budget and the dates; pre-save there is no trip
                  // row yet, so this is assembled from the form's own values.
                  trip={{ id: "preview", destination, startDate, endDate, budget }}
                  animateReveal={revealAnimation}
                  panelCollapsed={planCollapsed}
                  onMinimize={() => setPlanCollapsed(true)}
                />
              )}

              {!focus.target && <FeedbackLoop onSave={save} onRefine={refine} saving={saving} refining={refining} />}
            </div>

            {selectedStop && (
              <PlaceDetailPanel
                stop={selectedStop}
                detail={detail}
                loading={detailLoading}
                error={detailError}
                onBack={closeDetail}
                upcomingStops={upcomingStopsAfter(itinerary, selectedStop)}
                onSelectUpcoming={selectStop}
              />
            )}
          </div>
        </DockedPanel>
      )}
    </main>
  );
}
