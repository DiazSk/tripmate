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
  Minus,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Plus,
  Wallet,
} from "lucide-react";
import type { DayEditUpdates } from "@/components/DayHeader";
import FeedbackLoop from "@/components/FeedbackLoop";
import InterestPicker from "@/components/InterestPicker";
import ExplorerStylePicker from "@/components/ExplorerStylePicker";
import GroupTypePicker from "@/components/GroupTypePicker";
import PartyCounter, { DEFAULT_PARTY, PartyStepButton } from "@/components/PartyCounter";
import { PARTY_MAX_PER_BAND } from "@/lib/userAnswers";
import DietaryPicker from "@/components/DietaryPicker";
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
  AccessibilityNeeds,
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
import { readEventStream } from "@/lib/eventStream";
import { STAGE_ORDER, StageEvent } from "@/lib/generationStages";
import type { StageProgress } from "@/lib/generationStages";
import { buildDestinationFacts } from "@/lib/destinationFacts";
import { formatDateRange } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

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
// Behind its own boundary like every other blue-hour piece: it is only ever on stage during the
// plan step, and its two crops should not be fetched by a traveller who never opens the form.
const SceneBackdrop = dynamic(() => import("@/components/blue-hour/SceneBackdrop"), { ssr: false });
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

/** The same three mappings `pickGroup` applies when a traveler actively changes group type,
 *  reused here so a persisted profile's group and its party count start in agreement — a
 *  restored "Family with kids" used to sit next to a lone, unconfigured adult because `group`
 *  read the saved profile while `party` always started at `DEFAULT_PARTY`. "Other" has no
 *  mapping here for the same reason `pickGroup` gives it none: it is the one group shape with no
 *  fixed headcount, so the party stays exactly what it already was rather than being guessed. */
function defaultPartyForGroup(group: GroupType): PartyCounts {
  if (group === "couple") return { adults: 2, children: 0, infants: 0 };
  if (group === "family_with_kids") return { adults: 2, children: 1, infants: 0 };
  return DEFAULT_PARTY;
}

/** How long the loader holds after the run settles, so the marker reaches the pin and the pin
 *  fills before the itinerary takes the screen. Long enough to read as an arrival, short
 *  enough that nobody waiting two minutes notices it as a delay. */
const ARRIVAL_HOLD_MS = 650;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Step = "landing" | "plan" | "result";
/** Three questions and a review, replacing the old four ("basics" -> "purpose" -> "group" ->
 *  "pois"). "purpose" is gone as its own screen — a single optional text input never justified a
 *  full step — and now opens "preferences" alongside interests and explorer style, which used to
 *  be hidden behind a collapsed "Adjust for this trip" expander here on `basics`; the critique
 *  that flagged them as invisible was right; a click most travelers never made is not
 *  "available". "pois" is gone as a terminal screen too: it was empty more often than not
 *  (`OPENTRIPMAP_API_KEY` absent, or nothing nearby) and ended the flow on an apology with no
 *  summary of what was about to be generated. Both jobs move to "review" — the POI picker
 *  becomes one optional block on a screen that also states the whole trip back before
 *  committing to it. `review` still gives Step 2a's fetch the same three screens of runway
 *  `pois` used to. */
type PlanStep = "basics" | "group" | "preferences" | "review";
const PLAN_ORDER: PlanStep[] = ["basics", "group", "preferences", "review"];

function isPlanStep(value: string | null): value is PlanStep {
  return value === "basics" || value === "group" || value === "preferences" || value === "review";
}

// sessionStorage key for the in-progress wizard snapshot. Namespaced, not because anything else
// in this app touches sessionStorage yet, but because the browser tab does — a bare
// "planDraft" key is one accidental collision away from being someone else's storage bug.
const PLAN_DRAFT_KEY = "tripmate:planDraft";

// Local calendar date in ISO shape. `toISOString()` would be UTC and roll the date over a
// day early for anyone west of Greenwich in the evening; "sv-SE" formats local time as
// YYYY-MM-DD, which is exactly what <input type="date"> wants.
const todayISO = () => new Date().toLocaleDateString("sv-SE");

// One class, defined in globals.css, because both utility routes to a focus indicator failed
// here under measurement — `ring-*` silently, `focus-visible:outline-accent` by dropping only its
// colour. The rule and the evidence live next to `.glass-control`, which made the same move for
// hover for the same reason.
const focusRingClass = "focus-ring";
const ghostButtonClass =
  `rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg ${focusRingClass}`;
// Shared glass-over-globe card treatment — same class the itinerary/detail
// panels use, reused here for consistency across every step of this page.
// `pointer-events-auto` opts back in from AppShell's `pointer-events-none` overlay, which
// exists so the Cesium canvas underneath stays draggable. Every interactive box needs it.
// It carried `.is-opaque` until `SceneBackdrop` existed, and the reasoning was sound at the time:
// the plan step runs with `globeWanted` false, and a 56px blur of flat `--canvas` is a blur of
// nothing that still costs a render surface. There is a photograph behind the wizard now, so the
// frost has something to sample and the premise is gone — taking the opacity off is what lets the
// image read through the glass at all. The test is "is anything painted behind this card", which
// was indistinguishable from "is the globe on" right up until it wasn't.
const cardClass = "glass-itinerary pointer-events-auto rounded-2xl p-5 sm:p-6";

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

/** One Q&A screen: heading, optional subline, body. Every step uses this — `basics` included, as
 *  of the accessibility pass. It had no heading of any level, so `document.querySelectorAll(
 *  "h1,h2,h3")` returned nothing on the first screen of the flow and heading navigation had
 *  nowhere to land.
 *
 *  This also owns focus on a step change. Each step is conditionally rendered, so advancing
 *  unmounts one `Screen` and mounts the next, and the mount effect below is the transition. Before
 *  it, pressing Next left `document.activeElement` on `<body>` (or on the Next button itself) with
 *  no live region, no title change and no route change — so an assistive-technology user got no
 *  signal at all that the screen had changed.
 *
 *  `tabIndex={-1}` makes the heading a programmatic focus target without adding a tab stop. There
 *  is deliberately no visible ring: `:focus-visible` does not match on programmatic `.focus()`,
 *  only on keyboard-initiated focus, so the heading announces without painting an outline nobody
 *  asked for. No `aria-live` region alongside it either — moving focus already announces the new
 *  context, and doing both makes a screen reader say the step name twice. */
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="value-in" style={{ animationDelay: "80ms" }} {...devLabel(`PlanStep.${name}`)}>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-xl font-semibold text-foreground outline-none"
      >
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** One fact on the review screen: a label, its value, and a jump back to the step that owns it.
 *  Every prior version of this flow ended on a question instead of a statement — the traveler
 *  committed to a ~2-minute generation having never seen the trip stated back to them. This is
 *  the whole fix, repeated per fact rather than built as one paragraph, so any single answer is
 *  one click from being changed instead of a full trip back through the wizard. */
function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: ReactNode;
  /** Omit for a fact that isn't set on a different step — there's nowhere else for "Edit" to
   *  send it, so the row renders without the button rather than a link that goes nowhere. */
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div>
        <div className="text-xs font-semibold tracking-[0.025em] text-muted uppercase">
          {label}
        </div>
        <div className="mt-0.5 text-sm text-foreground">{value}</div>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-accent underline-offset-4 hover:underline ${focusRingClass}`}
        >
          Edit
        </button>
      )}
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
  // Was `useState(1000)`. Every traveler used to open the wizard to a total they never typed,
  // rendered in the same filled weight as a real value — and that number silently set the
  // spending tier the whole plan is generated against before anyone touched the field. Starting
  // empty means the field asks rather than answers; `budget === 0` already renders it blank
  // (see the input below), so this is the one line that had to change.
  const [budget, setBudget] = useState(0);
  const [interests, setInterests] = useState<string[]>(initialProfile?.priorities ?? []);
  const [starredInterests, setStarredInterests] = useState<string[]>(
    initialProfile?.topPriorities ?? []
  );
  const [destinationMissed, setDestinationMissed] = useState(false);

  // Step 2b — collected alongside the existing basics/interests/style answers, sent to
  // Step 3 as `userAnswers` once generation runs (see `generate()` below).
  const [purpose, setPurpose] = useState("");
  const [explorerStyle, setExplorerStyle] = useState<ExplorerStyle>(
    initialProfile?.explorerStyle ?? "mixed"
  );
  const [group, setGroup] = useState<GroupType>(initialProfile?.group ?? "solo");
  const [groupOther, setGroupOther] = useState("");
  const [party, setParty] = useState<PartyCounts>(
    defaultPartyForGroup(initialProfile?.group ?? "solo")
  );
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
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [notifyOnDone, setNotifyOnDone] = useState(false);
  const [notifyBlocked, setNotifyBlocked] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>(
    STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const }))
  );
  const [saving, setSaving] = useState(false);
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  /** 0-based days a chat turn changed while the traveler was reading a different one. Owned here
   *  rather than in the card because the chat that produces them lives beside it, not inside it. */
  const [unseenChangedDays, setUnseenChangedDays] = useState<number[]>([]);
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

  // Restores an in-progress wizard after a refresh. Mount-only, and it only ever fires on a
  // genuine reload: `goToStep` below keeps the URL's `?step=` in sync with `planStep` via
  // `history.pushState`, which never triggers a new mount — this effect exists for the one path
  // that does. Bails immediately when there's nothing to restore, which is every first visit and
  // every visit that isn't mid-wizard, so a fresh landing or a `/?step=` link with no matching
  // sessionStorage entry (a different tab, storage cleared, a stale bookmark) falls through to
  // the ordinary `initialProfile`-seeded defaults below untouched.
  //
  // A lazy `useState(() => …)` initializer per field would be the usual fix for "restore browser
  // state before first paint, not after it" — it avoids exactly the extra render pass
  // `react-hooks/set-state-in-effect` is warning about below. It isn't safe here: this component
  // renders once on the server, where `sessionStorage`/`location.search` don't exist, and once on
  // the client for hydration, which React requires to produce the *same* output as that server
  // render. A lazy initializer reading real browser state would make the two diverge — a
  // destination and a set of dates appearing in the hydrated DOM that were never in the
  // server-rendered HTML — which is a hydration mismatch, not a lint warning. Restoring in an
  // effect, one render late, is the safe side of that tradeoff: the extra render is real but
  // small (React 18's automatic batching folds every `setState` call below into that one render,
  // not twenty), and it only ever happens on a mid-wizard refresh, not on every visit.
  /* eslint-disable react-hooks/set-state-in-effect -- see the note above; the lazy-initializer
     fix this rule suggests would reintroduce a real SSR/hydration mismatch. */
  useEffect(() => {
    const urlStep = new URLSearchParams(window.location.search).get("step");
    if (!isPlanStep(urlStep)) return;
    let draft: Record<string, unknown> | null = null;
    try {
      draft = JSON.parse(sessionStorage.getItem(PLAN_DRAFT_KEY) ?? "null");
    } catch {
      draft = null;
    }
    if (!draft) return;

    const restore = <T,>(key: string, fallback: T): T =>
      key in draft! ? (draft![key] as T) : fallback;
    setDestination(restore("destination", ""));
    setStartDate(restore("startDate", ""));
    setEndDate(restore("endDate", ""));
    setBudget(restore("budget", 0));
    setParty(restore("party", DEFAULT_PARTY));
    setGroup(restore("group", "solo" as GroupType));
    setGroupOther(restore("groupOther", ""));
    setDietary(restore("dietary", { tags: [], note: "" } as DietaryNeeds));
    setPurpose(restore("purpose", ""));
    setExplorerStyle(restore("explorerStyle", "mixed" as ExplorerStyle));
    setEnergy(restore("energy", "moderate" as EnergyLevel));
    setCrowds(restore("crowds", "mixed" as CrowdPreference));
    setInterests(restore("interests", [] as string[]));
    setStarredInterests(restore("starredInterests", [] as string[]));
    setSelectedPois(restore("selectedPois", [] as CandidatePoi[]));
    setCustomPois(restore("customPois", [] as string[]));
    setArrivalTime(restore("arrivalTime", ""));
    setArrivalPoint(restore("arrivalPoint", ""));
    setDepartureTime(restore("departureTime", ""));
    setDeparturePoint(restore("departurePoint", ""));
    setOriginCity(restore("originCity", ""));
    setStayBooked(restore("stayBooked", ""));
    setAccessibility(restore("accessibility", null as AccessibilityNeeds | null));
    setStep("plan");
    setPlanStep(urlStep);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The other half of restore-on-refresh: snapshot the answers a traveler could lose to a
  // refresh or a closed tab, every time one of them changes, while the wizard is open. Skipped
  // once results exist — `generate()`'s success path clears this key outright, so an empty
  // history query string on the result screen never has a stale draft to resurrect.
  useEffect(() => {
    if (step !== "plan") return;
    const draft = {
      destination, startDate, endDate, budget, party, group, groupOther, dietary, purpose,
      explorerStyle, energy, crowds, interests, starredInterests, selectedPois, customPois,
      arrivalTime, arrivalPoint, departureTime, departurePoint, originCity,
      stayBooked, accessibility,
    };
    try {
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* Private browsing / quota — the wizard still works, it just can't survive a refresh. */
    }
  }, [
    step, destination, startDate, endDate, budget, party, group, groupOther, dietary, purpose,
    explorerStyle, energy, crowds, interests, starredInterests, selectedPois, customPois,
    arrivalTime, arrivalPoint, departureTime, departurePoint, originCity,
    stayBooked, accessibility,
  ]);

  // The fix for the wizard destroying every answer on a back-swipe. Before this, leaving the
  // plan step was the only way out — no history entry existed for any of its four (now three)
  // sub-steps, so system Back and a phone's edge-swipe both exited the page outright. `goToStep`
  // below pushes one entry per step forward; this walks them backward, and unlike an unmount,
  // nothing here ever discards the component's own state — `planStep` is the only thing that
  // changes, so every field the traveler already filled in survives the trip back through the
  // wizard regardless of which direction closed it.
  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      if (step !== "plan") return;
      const state = event.state as { tripmatePlanStep?: PlanStep } | null;
      if (state?.tripmatePlanStep) {
        setPlanStep(state.tripmatePlanStep);
      } else {
        // Walked back past the wizard's first pushed entry, to whatever was there before it —
        // the browser has already popped that entry, so this only needs to update React state
        // to match, not touch history again.
        backToLanding();
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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

  // Nights, not days: the review screen states this separately because lodging is priced by
  // night and the two numbers are never the same one — a 6-day trip books 5 nights, and nothing
  // before the review screen ever said so.
  const nights = days === null ? null : Math.max(days - 1, 0);

  // Total headcount, used for the per-person budget line on `basics` and the party line on
  // `review`. `party.adults` is never 0 (every path that sets it enforces a floor of 1), so this
  // is always at least 1 and safe to divide by.
  const totalTravelers = party.adults + party.children + party.infants;

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
    // "Other" is left alone here for the same reason `defaultPartyForGroup` leaves it
    // unmapped: it is the one shape with no fixed headcount, so overwriting it would erase
    // whatever the traveler already dialed in on the counter below.
    if (next !== "other") setParty(defaultPartyForGroup(next));
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
    // Drops the in-progress draft so a later refresh (a genuinely new visit, or planning a
    // second trip) never resurrects an abandoned wizard. Harmless if this runs from the popstate
    // handler, where the browser already removed the entry that would have restored it.
    try {
      sessionStorage.removeItem(PLAN_DRAFT_KEY);
    } catch {
      /* nothing to clean up if storage was never writable */
    }
  }

  /** Pushes one history entry per forward step, so the wizard has something for the browser's
   *  own Back — and a phone's edge-swipe — to walk instead of exiting the page outright. Every
   *  in-wizard "Next" and every review-screen "Edit" link goes through this rather than a bare
   *  `setPlanStep`, so the URL and the browser's history stack never fall out of sync with what
   *  is actually on screen. */
  function goToStep(next: PlanStep) {
    const url = new URL(window.location.href);
    url.searchParams.set("step", next);
    window.history.pushState({ tripmatePlanStep: next }, "", url);
    setPlanStep(next);
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
   * Fires when generation finishes while the tab is backgrounded. The title flash needs no
   * permission and always runs; the Notification is gated on `permitted` (granted at opt-in,
   * see handleNotifyToggle) since firing an unpermitted one throws.
   */
  function notifyGenerationDone(ok: boolean, permitted: boolean) {
    if (typeof document === "undefined" || !document.hidden) return;

    const original = document.title;
    document.title = ok ? "✅ Itinerary ready!" : "⚠️ Generation failed";
    const restoreTitle = () => {
      if (!document.hidden) {
        document.title = original;
        document.removeEventListener("visibilitychange", restoreTitle);
      }
    };
    document.addEventListener("visibilitychange", restoreTitle);

    if (permitted && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(
        ok ? "Your itinerary is ready!" : "Itinerary generation failed",
        { body: ok ? "Click to view your trip." : "Something went wrong — tap to try again." }
      );
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  }

  // The permission prompt only fires from here — a real click — never proactively.
  async function handleNotifyToggle(checked: boolean) {
    if (!checked) {
      setNotifyOnDone(false);
      setNotifyBlocked(false);
      return;
    }
    if (typeof Notification === "undefined") {
      setNotifyOnDone(false);
      setNotifyBlocked(true);
      return;
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    setNotifyOnDone(permission === "granted");
    setNotifyBlocked(permission !== "granted");
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
      notifyGenerationDone(true, notifyOnDone);
      // The wizard's job is done — drop its draft and the `?step=` it leaves in the URL, or a
      // refresh on this result page would find both still there and restore straight back into
      // the wizard instead of showing what was just generated.
      try {
        sessionStorage.removeItem(PLAN_DRAFT_KEY);
      } catch {
        /* nothing to clean up if storage was never writable */
      }
      window.history.replaceState(null, "", window.location.pathname);

      // Deliberately no profile write here. The preferences step's values are a per-trip
      // override, and writing them back would silently make one unusual trip the traveler's
      // permanent default — the bug this codebase already hit twice with `tier`. /profile and
      // the onboarding card are the only writers.
    } catch (e) {
      // A cancel arrives here as an AbortError. It is not a failure and must not be reported
      // as one — cancelGeneration has already reset the UI.
      if (!isAbort(e)) {
        setError(errorMessage(e, "We couldn't build your itinerary. Try generating again."));
        notifyGenerationDone(false, notifyOnDone);
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
    try {
      sessionStorage.removeItem(PLAN_DRAFT_KEY);
    } catch {
      /* nothing to clean up if storage was never writable */
    }
    // This one call is what makes system Back and a phone's edge-swipe walk the wizard instead
    // of leaving the page — it's the first pushed entry, and the popstate handler's "nothing in
    // event.state" branch is specifically "walked back past this one".
    const url = new URL(window.location.href);
    url.searchParams.set("step", "basics");
    window.history.pushState({ tripmatePlanStep: "basics" as PlanStep }, "", url);
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
      {/* The photograph the form stands on, from the moment the traveller opens it until their
          plan appears. Not rendered while generating: GenerationScreen is a full-bleed opaque
          layer that paints this same image itself, so a second copy underneath would be two
          decodes of one file to show one picture. */}
      {step === "plan" && !generating && !refining && <SceneBackdrop />}

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
              and stops them reading as a pair.

              That reasoning is about `basics` and only ever was: it is the one step with a
              three-column field row to keep off the screen edges. The other three inherited the
              width rather than asking for it, and inheriting it is what produced a 1182x36 input
              (a 33:1 box) sitting alone in a 1232px card, and 1054px between "Adults" and the
              stepper that changes it - `PartyCounter`'s rows are `justify-between`, so the gap is
              whatever the container gives them. Proximity is the strongest grouping cue there is
              and a full screen-width sweep from a label to its own control breaks it. Each step now
              gets the width its content asks for. Measured at 1280: the label/stepper gap goes
              1054px -> ~590px, and the lone input stops being a rule with a cursor in it. */}
          <div
            className={`w-full space-y-4 ${planStep === "basics" ? "max-w-[84rem]" : "max-w-3xl"}`}
          >
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
                  goToStep("group");
                  return;
                }
                const at = PLAN_ORDER.indexOf(planStep);
                if (at < PLAN_ORDER.length - 1) {
                  goToStep(PLAN_ORDER[at + 1]);
                  return;
                }
                generate();
              }}
              className={`hero-rise ${cardClass}`}
            >
              {planStep === "basics" && (
                <Screen
                  name="Basics"
                  title="Where and when"
                  subtitle="Destination, dates and what you want to spend in total."
                >
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
                      {/* The cell keeps the full row - the divider has to span the trough and the
                          whole cell stays clickable - but the control inside it does not. Uncapped,
                          "Kyoto, Japan" got a 1180px box for ~90px of glyphs, and the suggestion
                          dropdown inherited that width: `absolute inset-x-0` on a `relative w-full`
                          wrapper, so it spanned the console and covered Start, End and Total budget,
                          hiding all three required fields while you filled the first one. Capping
                          here fixes the input and the dropdown together, because the dropdown is
                          positioned against this box. 28rem holds the longest realistic
                          `City, Country` at the fluid root's top end. */}
                      <div className="max-w-[28rem]">
                        <DestinationSearch
                          variant="bare"
                          ariaLabel="Destination"
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
                      </div>
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
                            // Placeholder, not a value: budget used to start at a real 1000 with
                            // nothing to distinguish it from a number the traveler had typed. An
                            // empty required field with no hint of scale is its own problem, so
                            // this teaches the shape the way "Kyoto, Japan" teaches Destination.
                            placeholder="3000"
                            value={budget === 0 ? "" : budget}
                            onChange={(e) => setBudget(Number(e.target.value))}
                            className={`${fieldInputClass} tabular-nums ${budget === 0 ? fieldEmptyTone : fieldFilledTone}`}
                          />
                        </div>
                        {/* Compact — one band, not the three-band PartyCounter that owns the full
                            breakdown on "Who's going?". Party size is the largest multiplier on
                            what the budget above buys, and it used to arrive a full screen after
                            the number it modifies; this lets the traveler see the per-person
                            split without leaving the field that drives it. Adjusts `adults` only
                            — children and infants stay whatever they already are (0 unless a
                            restored profile or "Who's going?" set them) — but the total below
                            counts all three, so it stays honest even when this control alone
                            can't change every band. */}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-xs text-muted">Travelers</span>
                          <div className="flex items-center gap-1">
                            <PartyStepButton
                              icon={Minus}
                              label="Remove one adult"
                              atBound={party.adults <= 1}
                              onClick={() => setParty((p) => ({ ...p, adults: p.adults - 1 }))}
                            />
                            <span
                              aria-live="polite"
                              className="w-6 text-center text-sm font-medium tabular-nums text-foreground"
                            >
                              {totalTravelers}
                            </span>
                            <PartyStepButton
                              icon={Plus}
                              label="Add one adult"
                              atBound={party.adults >= PARTY_MAX_PER_BAND}
                              onClick={() => setParty((p) => ({ ...p, adults: p.adults + 1 }))}
                            />
                          </div>
                        </div>
                        {/* Until this line existed, picking two dates never told you how long the
                            trip was — the day count was computed for the tier cards and never
                            shown. Saying what the budget buys per day answers both at once, and
                            it's the division the traveler was going to do anyway. Now divided
                            across travelers too: "$500/day for 6 days" read as a per-trip figure
                            even after a family of four was already dialled in two screens away
                            from where it was stated. */}
                        {days !== null && budget > 0 && (
                          <div
                            key={`${budget}-${days}-${totalTravelers}`}
                            className="value-in mt-0.5 text-xs tabular-nums text-muted"
                          >
                            {formatMoney(Math.round(budget / days / totalTravelers))}/day
                            {totalTravelers > 1 ? " per person" : ""} for {days}{" "}
                            {days === 1 ? "day" : "days"}
                          </div>
                        )}
                        {/* The tier itself was invisible here before this line — `tier` (below)
                            was always derived from budget and days, but nothing on this screen
                            ever named it, so the product's own stated differentiator (an
                            itinerary anchored to a chosen spending tier) was set by a number the
                            traveler typed and never confirmed. This replaces the dead "Style and
                            budget" label that used to sit alone in the Adjust panel with
                            nothing under it — the tier isn't a pickable preference like the
                            fields that share that panel, so it belongs where it's derived, not
                            behind a second click. Description text is `TIERS`' own copy, already
                            written for the tier cards this app no longer shows. */}
                        {days !== null && budget > 0 && (
                          <div
                            key={`tier-${tier}`}
                            className="value-in mt-0.5 text-xs text-muted"
                          >
                            Closest match:{" "}
                            <span className="font-medium text-foreground">
                              {TIERS.find((t) => t.id === tier)?.name}
                            </span>{" "}
                            — {TIERS.find((t) => t.id === tier)?.description}
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
                            // `truncate`: this cell holds a fixed 6.5rem time field plus this one,
                            // and at the console's three-column intermediate widths (~800px) the
                            // remainder measured ~126px — enough to clip "Anywhere you like"
                            // mid-word with a hard edge. An ellipsis is the honest version of the
                            // same clip: it still doesn't fit, but it says so instead of cutting a
                            // glyph in half.
                            inputClassName={`${fieldInputClass} truncate ${arrivalPoint ? fieldFilledTone : fieldEmptyTone}`}
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
                            // Same clipping, same fix — see the Arrive cell above.
                            inputClassName={`${fieldInputClass} truncate ${departurePoint ? fieldFilledTone : fieldEmptyTone}`}
                          />
                        </div>
                      </Field>
                    </div>
                  </div>

                  {/* Read by skill §4e ("already booked beats anything you would recommend"),
                      by `formatTravelerProfile` and by `trip-context.md` — all three already
                      read `userAnswers.logistics.stayBooked`, which nothing in this form
                      collected until now, so a booked hotel was being re-chosen by the model
                      every time. */}
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
                    {/* Dietary lives here now, not just on /profile — it changes what fits at the
                        table exactly the way the party size above changes how many chairs it
                        needs, and neither was reachable from the wizard before this. */}
                    <div className="border-t border-white/10 pt-3">
                      <label className="text-xs font-medium text-muted">Dietary needs</label>
                      <div className="mt-2">
                        <DietaryPicker value={dietary} onChange={setDietary} />
                      </div>
                    </div>
                  </div>
                </Screen>
              )}

              {/* Everything that used to hide behind a collapsed "Adjust for this trip" link on
                  `basics` — the critique that called those invisible was right; a click most
                  travelers never made is not "available". Occasion, which used to be its own
                  screen for one optional text input, joins them here rather than keeping a step
                  that asked one question and nothing else. */}
              {planStep === "preferences" && (
                <Screen
                  name="Preferences"
                  title="What you're after"
                  subtitle="Occasion, pace and what to prioritise. All optional, and specific to this trip."
                >
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Occasion</label>
                      <input
                        type="text"
                        value={purpose}
                        onChange={(e) => setPurpose(e.target.value)}
                        placeholder="e.g. anniversary trip, first time in Japan, work + play"
                        aria-label="What's the occasion?"
                        className="w-full rounded-full bg-white/10 px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                      />
                    </div>
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
                    {/* Asked directly rather than inferred from `energy` above — "how much do you
                        want to walk" and "can you manage stairs" are different questions, and
                        `deriveMobilityProfile` used the first as a proxy for both until this
                        existed, so a wheelchair user describing their energy as high got no
                        accommodation at all. */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Getting around</label>
                      <div className="space-y-2 rounded-2xl border border-white/10 bg-surface-deep/50 px-4 py-3">
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
                    <p className="text-xs text-muted">
                      These apply to this trip only. Your saved profile is untouched — edit it on
                      the{" "}
                      <Link
                        href="/profile"
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        profile page
                      </Link>
                      .
                    </p>
                  </div>
                </Screen>
              )}

              {/* The terminal screen, and the only one meant to be read rather than answered.
                  Every prior version of this flow ended here on a question — "anywhere you
                  already know you want to go?" — with no summary of what was about to be
                  generated. This states the trip back before committing to it: the derived tier
                  was invisible in the whole flow until now, and "6 days" never told anyone it
                  meant 5 nights of lodging, the largest line item a budget has to cover. */}
              {planStep === "review" && (
                <Screen
                  name="Review"
                  title="Review your trip"
                  subtitle="Here's everything before we start planning."
                >
                  <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-surface-deep/50 px-4">
                    <ReviewRow
                      label="Destination"
                      value={destination || "Not set"}
                      onEdit={() => goToStep("basics")}
                    />
                    <ReviewRow
                      label="Dates"
                      value={
                        startDate && endDate
                          ? `${formatDateRange(startDate, endDate)} · ${days} ${days === 1 ? "day" : "days"}, ${nights} ${nights === 1 ? "night" : "nights"}`
                          : "Not set"
                      }
                      onEdit={() => goToStep("basics")}
                    />
                    <ReviewRow
                      label="Budget"
                      value={
                        budget > 0
                          ? `${formatMoney(budget)} · ${TIERS.find((t) => t.id === tier)?.name}`
                          : "Not set"
                      }
                      onEdit={() => goToStep("basics")}
                    />
                    <ReviewRow
                      label="Travelers"
                      value={
                        <>
                          {party.adults} {party.adults === 1 ? "adult" : "adults"}
                          {party.children > 0 &&
                            `, ${party.children} ${party.children === 1 ? "child" : "children"}`}
                          {party.infants > 0 &&
                            `, ${party.infants} ${party.infants === 1 ? "infant" : "infants"}`}
                        </>
                      }
                      onEdit={() => goToStep("group")}
                    />
                    {/* No edit link on this one — unlike the facts above, it isn't set on a
                        different step to jump back to. The picker naming it is right below. */}
                    <ReviewRow
                      label="Stops picked ahead of time"
                      value={
                        selectedPois.length + customPois.length > 0
                          ? `${selectedPois.length + customPois.length}`
                          : "None yet — add any below"
                      }
                    />
                  </div>

                  <div className="mt-5">
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
                  </div>

                  {/* The one reassurance this flow never gave before committing to a ~2-minute
                      run: that it can be stopped, and that the result isn't final. Both were
                      already true — `GenerationScreen` takes `onCancel`, and `FeedbackLoop`
                      exists — neither was ever said here, where a hesitating traveler needed it. */}
                  <p className="mt-4 text-xs text-muted">
                    Takes about two minutes. You can cancel any time, and refine the plan in plain
                    language afterwards.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={notifyOnDone}
                      onChange={(e) => void handleNotifyToggle(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-card-border"
                    />
                    Notify me when it&apos;s ready
                  </label>
                  {notifyBlocked && (
                    <p className="mt-1 text-xs text-muted">
                      Notifications are blocked in your browser — we&apos;ll still flash the tab
                      title when it&apos;s done.
                    </p>
                  )}
                </Screen>
              )}

              {/* `justify-end`, not the `justify-between` this was. Both controls do the same job -
                  move the wizard - so they are one group, and `justify-between` was pinning them to
                  opposite ends of whatever the card happened to be: 1088px apart on `basics` at
                  1280. At that distance they stop reading as a pair and the eye has to cross the
                  whole card to find the action, which is the exact failure the 84rem comment above
                  was already worried about. Clustering fixes it at every width instead of at one.
                  Next stays rightmost, so "forward" keeps the position the flow taught. */}
              <div
                className="value-in mt-6 flex items-center justify-end gap-3 border-t border-card-border pt-5"
                style={{ animationDelay: "440ms" }}
              >
                {/* `window.history.back()`, not a direct `setPlanStep`/`backToLanding` branch.
                    This button, the browser's own Back, and a phone's edge-swipe all used to be
                    three different code paths — only this one had any effect, which is exactly
                    why the other two destroyed every answer instead of walking the wizard.
                    Routing all three through the same `popstate` handler (above) means there is
                    now exactly one way this can go wrong instead of three. */}
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className={ghostButtonClass}
                >
                  Back
                </button>
                {planStep === PLAN_ORDER[PLAN_ORDER.length - 1] ? (
                  // The terminal button, deliberately unlike every "Next" before it: no arrow —
                  // there's nowhere further to imply — and wider, so committing to a ~2-minute
                  // generation doesn't sit in a pill sized and shaped like the three-times-
                  // repeated "keep going" button that trained the traveler's muscle memory to
                  // press it without reading it.
                  <button
                    type="submit"
                    className={`rounded-full bg-accent px-8 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] ${focusRingClass}`}
                  >
                    Generate itinerary
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={`group inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-[0.98] ${focusRingClass}`}
                  >
                    Next
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
                      strokeWidth={2.25}
                    />
                  </button>
                )}
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
