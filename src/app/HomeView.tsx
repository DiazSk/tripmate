"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { draftFailedNote, type DraftState } from "@/components/FeedbackLoop";
import { DEFAULT_PARTY } from "@/components/PartyCounter";
import {
  legacyExplorerStyle,
  MAX_STARRED_PRIORITIES,
  sanitizeNamedList,
  travelStyleOf,
} from "@/lib/userAnswers";
import type { SuggestOption } from "@/components/SuggestInput";
import { usePublishItinerary } from "@/lib/activeItinerary";
import PolarLanding from "@/components/polar/PolarLanding";
import PlanningFlow, { type PlannerModel } from "@/components/polar/planner/PlanningFlow";
import { suggestionLabel } from "@/lib/weather";
import { setHomeScreen } from "@/lib/homeScreen";
import type { PlanPrefill } from "@/lib/planExamples";
import DockedPanel from "@/components/DockedPanel";
import { capsuleDays } from "@/lib/planProgress";
import { closestTier, perPersonBudget, tripDays, TierId, TIERS } from "@/lib/tiers";
import {
  AccessibilityNeeds,
  Anchor,
  CrowdPreference,
  DayPlan,
  DestinationContext,
  EnergyLevel,
  DiscoveryPreference,
  ExplorerStyle,
  PacePreference,
  GroupType,
  Itinerary,
  PartyCounts,
  RawFetch,
} from "@/lib/types";
import type { StreamedStop } from "@/lib/streamingItinerary";
import type { SketchDay } from "@/lib/sketch";
import { CandidatePoi } from "@/lib/pois";
import { useStreamingCamera, useTripCamera } from "@/lib/useTripCamera";
import { useGlobeOnScreen, useMapCamera } from "@/lib/mapCamera";
import type { ArrivalPoint } from "@/lib/arrivalPoints";
import { clearUnseenDay, changedDayNumbers, markUnseenDays } from "@/lib/unseenChanges";
import { announceDraftRevision } from "@/lib/draftRevision";
import type { TravelerProfile, DietaryNeeds } from "@/lib/travelerProfile";
import { readEventStream } from "@/lib/eventStream";
import { STAGE_ORDER, StageEvent } from "@/lib/generationStages";
import type { StageProgress } from "@/lib/generationStages";
import { buildDestinationFacts } from "@/lib/destinationFacts";
import { formatDateRange } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { shouldFallBack } from "@/lib/streamRetry";
import { useToast } from "@/lib/toast";
import {
  failureFromResponse,
  failureFromStreamError,
  failureFromThrown,
  formatResumeTime,
  holdFromFailure,
  isAbort,
  type Failure,
} from "@/lib/failure";

/* `next/dynamic` boundaries, the same `{ ssr: false }` idiom AppShell uses for the globe.
   None of these renders on the landing step — the landing renders `<PolarLanding>` and nothing
   else — yet all of them were parsed at module scope before its first paint, because this module is
   one `"use client"` component covering all three steps of the flow. `ssr: false` costs nothing:
   the initial server render is always `step: "landing"`.

   ItineraryCard is the one that matters. It pulls DayHeader, StopList, BudgetBar, Typewriter and
   icons.tsx behind it — about half of what this module used to parse up front.

   Four other pickers stayed static (`InterestPicker`, `ExplorerStylePicker`, `GroupTypePicker`,
   `PoiCandidatePicker`): 1-4KB each, which one ItineraryCard boundary already beats. `ChoicePicker` *cannot* be split —
   it exports CROWD_PREFERENCES and ENERGY_LEVELS as values used in the render below.
   `DestinationSearch` is deliberately static too: it is the first field of the plan step,
   rendered in the same tick as the "Plan a trip" click, and the failure mode of a prefetch miss
   there is a form with no destination input. `PolarLanding` static is the whole point. */
const ItineraryCard = dynamic(() => import("@/components/ItineraryCard"), { ssr: false });
/** The result step: the trip page's own board, read-only, for a plan whose draft insert failed (see
 *  `showPlan`). Its stylesheet comes with it, so the landing never pays for a screen this rare. */
const loadTripBoard = () => import("@/components/polar/trip/TripBoard.css").then(() => import("@/components/polar/trip/TripBoard"));
const TripBoard = dynamic(loadTripBoard, { ssr: false });
const BoardInsets = dynamic(() => loadTripBoard().then((m) => m.BoardInsets), { ssr: false });
const noop = () => {};
// Behind its own boundary too: it is only on stage while a plan is being written.
const WritingThePlan = dynamic(() => import("@/components/polar/WritingThePlan"), { ssr: false });

/** Why a run failed. `dropped` is this page's own: the connection died under a stream that had
 *  opened (or under the one automatic retry), which `failure.ts` cannot tell from a server fault. */
type RunFailure = Failure | { kind: "dropped" };

/** Thrown by `runStreamed` and `save` so the catch knows what failed, never a sentence to print. */
class RunError extends Error {
  constructor(readonly failure: RunFailure) {
    super(failure.kind);
  }
}

function runFailureOf(e: unknown): RunFailure {
  if (e instanceof RunError) return e.failure;
  const f = failureFromThrown(e);
  // Online, a TypeError out of fetch or the stream reader is the socket dying, not a server answer.
  // One thrown by our own event handling never gets here as a TypeError: `runStreamed` wraps it.
  return f.kind === "server" && e instanceof TypeError ? { kind: "dropped" } : f;
}

/** A failure written where it happened (the planner's bar, the result board's Keep note). */
type Note = { text: string };

/** Copy rows P-33..P-36, P-38, P-39. P-37 (the limit) is a toast, raised by `generate`. */
function planFailureText(f: RunFailure, destination: string): string {
  const d = destination.trim();
  switch (f.kind) {
    case "offline":
      return `You’re offline, so your ${d} plan couldn’t be written. Your answers are kept. Press Plan my trip when you’re back online.`;
    case "dropped":
      return `The connection dropped while your ${d} plan was being written. Your answers are kept. Press Plan my trip to try again.`;
    case "timeout":
      return `Writing your ${d} plan took longer than TripMate allows, so it stopped. Your answers are kept. Press Plan my trip to try again.`;
    case "daily_cap":
      return `Planning is paused for everyone until ${formatResumeTime(f.resumesAt)}. TripMate has reached its limit for the day; it isn’t anything you did. Your answers are kept, and your saved trips and the map still work.`;
    // The server wrote this sentence (copy rows SV-14..SV-17, SV-20); shown as it is, with nothing to retry.
    case "refused":
      return f.message;
    case "invalid":
      return "TripMate couldn’t read your trip details. Go back to Basics, check the destination, dates and budget, then press Plan my trip.";
    default:
      return `TripMate hit a problem writing your ${d} plan and stopped. Your answers are kept. Press Plan my trip to try again.`;
  }
}

/** Copy row W-04's {causeShort}: the notification's reason, for a tab the traveller isn't looking at. */
function causeShort(f: RunFailure): string {
  switch (f.kind) {
    case "offline":
      return "You went offline.";
    case "dropped":
      return "The connection dropped.";
    case "timeout":
      return "It took too long.";
    case "rate_limited":
      return "You’ve planned 3 trips in 10 minutes.";
    case "daily_cap":
      return `Planning is paused for everyone until ${formatResumeTime(f.resumesAt)}.`;
    default:
      return "TripMate hit a problem.";
  }
}

/** Copy rows W-11..W-15: Keep this trip didn't keep it. */
function keepFailureText(f: RunFailure, plan: Itinerary): string {
  if (f.kind === "offline") return "You’re offline, so this trip wasn’t kept. Leave this tab open and press Keep this trip once you’re back online.";
  if (f.kind === "not_found") {
    return "This plan’s draft was removed, perhaps in another tab, so it couldn’t be kept. Press Keep this trip to save it as a new trip.";
  }
  if (f.kind === "invalid") {
    // The server names the stop in a sentence for developers; the same check here names it for the traveller.
    for (const [d, day] of plan.days.entries()) {
      const stop = day.stops.find((x) => !Number.isFinite(x.lat) || !Number.isFinite(x.lng));
      if (stop) {
        return `${stop.name} on day ${d + 1} has no place on the map, so this plan can’t be kept. Plan the trip again to get one that can be.`;
      }
    }
    return "This plan came back incomplete, so it can’t be kept. Plan the trip again to get a complete one.";
  }
  return "TripMate couldn’t keep this trip: its server had a problem. Your plan is still here. Press Keep this trip to try again.";
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
  /** Seeded from the saved profile, the same way `dietary` is. Access needs are a fact about
   *  the traveler rather than the trip, and re-asking every time is how a hard constraint
   *  (§9e) gets skipped on the one trip they forget. Still editable per trip. */
  const [accessibility, setAccessibility] = useState<AccessibilityNeeds | null>(
    initialProfile?.accessibility ?? null
  );
  /** Comma-separated as typed; split on submit. A chip editor is the nicer control and is not
   *  worth a component here — the field is optional and most travelers leave it empty. */
  /** Whether `budget` is one person's or everyone's. Defaults to the basis every reader
   *  already assumed, so an untouched control changes nothing. */
  const [budgetBasis, setBudgetBasis] = useState<"per_person" | "whole_party">("whole_party");
  const [mustInclude, setMustInclude] = useState("");
  const [avoid, setAvoid] = useState("");
  const [constraintsNote, setConstraintsNote] = useState("");

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
  /**
   * Two answers where the wizard used to take one.
   *
   * A stored profile carries only the legacy `explorerStyle`, so the initial values come
   * through `travelStyleOf` — which is also what stops a returning "offbeat" traveler being
   * shown a pace they never chose.
   */
  const [pace, setPace] = useState<PacePreference>(
    () => travelStyleOf(initialProfile ?? {}).pace
  );
  const [discovery, setDiscovery] = useState<DiscoveryPreference>(
    () => travelStyleOf(initialProfile ?? {}).discovery
  );
  /** Derived, never held: what a reader that only knows the old field gets. */
  const explorerStyle = legacyExplorerStyle({ pace, discovery });
  const [group, setGroup] = useState<GroupType>(initialProfile?.group ?? "solo");
  const [groupOther, setGroupOther] = useState("");
  const [party, setParty] = useState<PartyCounts>(
    defaultPartyForGroup(initialProfile?.group ?? "solo")
  );
  const [energy, setEnergy] = useState<EnergyLevel>(initialProfile?.energy ?? "moderate");
  const [crowds, setCrowds] = useState<CrowdPreference>(initialProfile?.crowds ?? "mixed");
  const [selectedPois, setSelectedPois] = useState<CandidatePoi[]>([]);
  const [customPois, setCustomPois] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);

  // Durable, and unlike the others it has no wizard screen — /profile is where it's set.
  // Held here only so generate() can send it.
  const [dietary, setDietary] = useState<DietaryNeeds>(
    initialProfile?.dietary ?? { tags: [], note: "" }
  );

  // Step 2a — fired fire-and-forget right alongside the existing destination-context
  // warmer, the moment basics are submitted. Never blocks the wizard from advancing;
  // `rawFetchLoading` only gates the POI picker's own loading state.
  const [rawFetch, setRawFetch] = useState<RawFetch | null>(null);
  const [rawFetchLoading, setRawFetchLoading] = useState(false);
  // The bundle's fetch itself failed (copy row P-31), which `rawFetch === null` alone can't say.
  const [rawFetchFailed, setRawFetchFailed] = useState(false);
  // Parsed festivals/shopping from the same fire-and-forget warmer below. Kept because the
  // model call has already been paid for — the alternative, fetching destination facts when
  // the loader appears, would mean a second model call for data already sitting in cache.
  const [destContext, setDestContext] = useState<DestinationContext | null>(null);
  // Aborts the in-flight generate. A ref, not state: cancelling must not re-render the
  // loader, and nothing renders off this value.
  const abortRef = useRef<AbortController | null>(null);

  /** Stops the run and returns to the form with every answer intact. */
  function cancelGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    // Half a plan is not a plan. The draft used to be safe to leave lying around because nothing
    // rendered it; it is the card and the map's route now, so a cancelled run would otherwise
    // leave a partial itinerary on screen until the next run happened to reset it.
    setDraftItinerary(null);
    setCoordsDay(null);
    // Clearing the draft unmounts the card, and the card is the only thing that calls
    // `showTripRoute` — so there is nothing left to redraw the map, and the half-drawn route and
    // its pins would sit on the globe until something else wiped them (the form's own backdrop
    // hides them, but the next Generate uncovers them again).
    resetToHome();
    // `resetToHome` flies the camera home and drops the pin, but the *reason* the destination was
    // ever framed is `lastFlownRef`, and nothing re-flies on Generate — `flyToTypedDestination`
    // only fires on blur of a field whose value changed. Left set, a Cancel-then-Generate on the
    // same destination opens on the world pose with no pin until the first stop lands. Clearing
    // it makes the next blur of the (unchanged) destination field count as new again.
    lastFlownRef.current = "";
    // Silent on purpose. The user asked for this; an error block telling them the planner
    // didn't finish would be the app reporting their own decision back to them as a fault.
    setError(null);
  }

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  // Id of the LLM pipeline run that produced the current `itinerary` — tracks
  // the most recent generate call so save() can attach it to the
  // trip, letting later place-detail calls append to that same run.
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  // The CLI session the generate call ran in. Saved with the trip, so the trip page's edit chat
  // continues that same conversation. Null whenever the
  // session is unknown or gone — every consumer treats that as "rebuild the full prompt".
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<DraftState>(null);
  /** The unsaved board (result step) folded to its ticket, the map whole. */
  const [boardShut, setBoardShut] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notifyOnDone, setNotifyOnDone] = useState(false);
  const [notifyBlocked, setNotifyBlocked] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>(
    STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const }))
  );
  /** The plan as it is being written, assembled from `stop` and `day-coords` frames. Null
   *  outside a generation — reset to null at the start and cleared once the plan lands. This is
   *  what the map and the itinerary card render during the wait — there is no separate loading
   *  view to keep in sync with it. */
  const [draftItinerary, setDraftItinerary] = useState<Itinerary | null>(null);
  /** The highest day index whose `day-coords` frame has landed, or null before the first one.
   *
   *  Exists for the camera, which must not fly to a stop's coordinates until Overpass has
   *  corrected them — the model writes them from memory and has been measured 11km out. Reset
   *  alongside `draftItinerary` on every path that starts or abandons a run. */
  const [coordsDay, setCoordsDay] = useState<number | null>(null);
  /** Set by any local mutation between `plan` and `revised`. Critique replaces the whole day
   *  set, so a revision that lands on top of an edit the traveller just made would silently
   *  discard it. */
  const editedSincePlanRef = useRef(false);
  const [saving, setSaving] = useState(false);
  // The day on screen: the result board's tabs set it, and the streaming card is handed it.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  /** 0-based days the critique's revision changed while the traveler was reading a different one,
   *  dotted on the result board's tabs until visited. */
  const [unseenChangedDays, setUnseenChangedDays] = useState<number[]>([]);
  /** The day on screen, readable from a closure that has been alive for minutes. `generate()`'s
   *  `revised` hook runs ~150s after the click and needs to know which tab the traveller is on
   *  *now* — its captured `activeDayIndex` is the value from the click and would mark a dot on
   *  the very day they are reading. */
  const activeDayRef = useRef(0);
  useEffect(() => {
    activeDayRef.current = activeDayIndex;
  }, [activeDayIndex]);
  // Publishes the plan to surfaces mounted outside this tree — the map's search control, which
  // lives with the map chrome in `AppShell`. A café added from the map lands in `itinerary`, so
  // Keep saves it with the rest of the plan.
  usePublishItinerary(itinerary, handleRearrange);
  const [error, setError] = useState<Note | null>(null);
  const { showError } = useToast();

  const { destinationCoords, flyToDestinationByName, flyToDestinationByCoords } = useTripCamera(destination);
  const { resetToHome, showTripRoute, setRouteConnectorsHidden, setNightLens } = useMapCamera();
  // The camera for the length of a run. Holds `showTripRoute`'s own per-stop framing and moves
  // once per day instead, when that day's real coordinates land — see `useStreamingCamera`.
  useStreamingCamera(generating, draftItinerary, coordsDay);

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
    // The welcome's Ready page links here as `/?plan=1`: "Plan a trip" opens the wizard rather
    // than the landing film. The param is dropped first so Back returns to a plain `/`.
    if (new URLSearchParams(window.location.search).get("plan") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      startPlanning();
      return;
    }
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
    // A draft saved before the split has only the legacy field; one saved since has both.
    setPace(restore("pace", travelStyleOf({ explorerStyle: restore("explorerStyle", "mixed" as ExplorerStyle) }).pace));
    setDiscovery(
      restore(
        "discovery",
        travelStyleOf({ explorerStyle: restore("explorerStyle", "mixed" as ExplorerStyle) }).discovery
      )
    );
    setEnergy(restore("energy", "moderate" as EnergyLevel));
    setCrowds(restore("crowds", "mixed" as CrowdPreference));
    setInterests(restore("interests", [] as string[]));
    setStarredInterests(restore("starredInterests", [] as string[]));
    setSelectedPois(restore("selectedPois", [] as CandidatePoi[]));
    setCustomPois(restore("customPois", [] as string[]));
    setAnchors(restore("anchors", [] as Anchor[]));
    setArrivalTime(restore("arrivalTime", ""));
    setArrivalPoint(restore("arrivalPoint", ""));
    setDepartureTime(restore("departureTime", ""));
    setDeparturePoint(restore("departurePoint", ""));
    setStayBooked(restore("stayBooked", ""));
    setAccessibility(restore("accessibility", null as AccessibilityNeeds | null));
    setBudgetBasis(restore("budgetBasis", "whole_party"));
    setMustInclude(restore("mustInclude", ""));
    setAvoid(restore("avoid", ""));
    setConstraintsNote(restore("constraintsNote", ""));
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
      pace, discovery, explorerStyle, energy, crowds, interests, starredInterests, selectedPois, customPois,
      anchors,
      arrivalTime, arrivalPoint, departureTime, departurePoint,
      stayBooked, accessibility, mustInclude, avoid, constraintsNote, budgetBasis,
    };
    try {
      sessionStorage.setItem(PLAN_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* Private browsing / quota — the wizard still works, it just can't survive a refresh. */
    }
  }, [
    step, destination, startDate, endDate, budget, party, group, groupOther, dietary, purpose,
    pace, discovery, explorerStyle, energy, crowds, interests, starredInterests, selectedPois, customPois,
    anchors,
    arrivalTime, arrivalPoint, departureTime, departurePoint,
    stayBooked, accessibility, mustInclude, avoid, constraintsNote, budgetBasis,
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
    void import("@/components/ItineraryCard");
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
  useGlobeOnScreen(generating || step === "result");

  // The night lens for the length of a generate (WritingThePlan's ground), lifting as the plan opens.
  // Off on the way out, too.
  useEffect(() => {
    setNightLens(generating);
  }, [generating, setNightLens]);
  useEffect(() => () => setNightLens(false), [setNightLens]);

  const preResult = step !== "result";

  // The nav shows only what this screen needs (src/lib/homeScreen.ts). Reset to the landing when
  // `/` unmounts, so the next visit does not open on the planner's nav before this runs again.
  useEffect(() => setHomeScreen(step), [step]);
  useEffect(() => () => setHomeScreen("landing"), []);

  /**
   * The plan on screen: the half-written one while a run is streaming, the finished one otherwise.
   *
   * One value rather than two render paths, deliberately — `ItineraryCard` is what drives
   * `showTripRoute`, so feeding it the draft is what puts the route and the markers on the map as
   * the model writes them. A second "streaming" card would mean a second thing to keep in step
   * with the real one.
   *
   * `itinerary` only on the result step: a generate has nothing to fall back to by definition.
   *
   * Read only where the question is "what is being shown": the streaming card, its capsule's day
   * count, and the anchor pins below. Everything that *edits* or *saves* still reads `itinerary`,
   * because a draft is not a plan anybody can keep yet.
   */
  const shownItinerary = step === "result" ? itinerary : draftItinerary;

  // The pile, on the map, before any plan exists: pins only, no route between them — they are
  // not an order yet. Hands the map back the moment a plan (draft or final) takes over.
  useEffect(() => {
    if (shownItinerary) return;
    const pins = anchors.flatMap((a) => (a.lat !== null && a.lng !== null ? [{ lat: a.lat, lng: a.lng, name: a.name, day: 0 }] : []));
    if (pins.length === 0) return;
    setRouteConnectorsHidden(true);
    showTripRoute([pins], null, true, false);
    return () => {
      setRouteConnectorsHidden(false);
      showTripRoute([], null, true, false);
    };
  }, [anchors, shownItinerary, showTripRoute, setRouteConnectorsHidden]);

  // Null until both dates are set, so the tier cards show per-day rates rather than a total
  // derived from tripDays' floor-at-1.
  const days = startDate && endDate ? tripDays(startDate, endDate) : null;

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
  // One traveller's share is what a tier prices (`perPersonBudget`), whichever way the budget was given.
  const tier: TierId =
    days === null
      ? "midrange"
      : closestTier(perPersonBudget(budget, budgetBasis, party.adults + party.children + party.infants), days);

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
        : prev.length >= MAX_STARRED_PRIORITIES
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

  /** The Step 2b answers, in one place — generation, save and the edit loop must all see the
   *  identical profile or the edit loop starts re-asking what planning already knew. */
  function currentAnswers() {
    return {
      purpose,
      // Both shapes: the pair is the answer, the legacy field is what older readers take.
      pace,
      discovery,
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
      anchors,
      // Sent as-is; `sanitizeLogistics` on the server collapses an all-empty object to null, so
      // a traveler who skipped the row gets the prompt they'd have got before it existed.
      logistics: {
        arrivalTime: arrivalTime || null,
        arrivalPoint: arrivalPoint || null,
        departureTime: departureTime || null,
        departurePoint: departurePoint || null,
        stayBooked: stayBooked || null,
      },
      accessibility,
      // Split here rather than in state so the field stays a plain text input; `sanitizeNamedList`
      // (shared with the server) drops blanks and de-dupes, returning `undefined` rather than `[]`
      // for an empty field — the guardrail and prompt both branch on "did the traveler name
      // anything", and `[]` reads as a demand for nothing rather than as silence.
      budgetBasis,
      mustInclude: sanitizeNamedList(mustInclude.split(",")),
      avoid: sanitizeNamedList(avoid.split(",")),
      constraintsNote: constraintsNote.trim() || null,
    };
  }

  /**
   * Fires when generation finishes while the tab is backgrounded. The title flash needs no
   * permission and always runs; the Notification is gated on `permitted` (granted at opt-in,
   * see handleNotifyToggle) since firing an unpermitted one throws.
   */
  function notifyGenerationDone(ok: boolean, permitted: boolean, cause = "") {
    if (typeof document === "undefined" || !document.hidden) return;

    const original = document.title;
    // Copy row W-03 for the failure.
    document.title = ok ? "✅ Itinerary ready!" : "Your plan wasn’t written · TripMate";
    const restoreTitle = () => {
      if (!document.hidden) {
        document.title = original;
        document.removeEventListener("visibilitychange", restoreTitle);
      }
    };
    document.addEventListener("visibilitychange", restoreTitle);

    if (permitted && typeof Notification !== "undefined" && Notification.permission === "granted") {
      // Copy row W-04 for the failure.
      const n = new Notification(
        ok ? "Your itinerary is ready!" : `Your ${destination.trim()} plan wasn’t written.`,
        { body: ok ? "Click to view your trip." : `${cause} Open TripMate to try again.` }
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
   * never opens at all — a network error before any response. A refusal (429, 503) is never
   * retried, since that would spend the allowance twice. Once
   * streaming has genuinely started, a mid-generation failure is never retried: it would
   * spend another two minutes and a second pair of model calls with no visibility to the
   * traveler that it's happening again.
   *
   * `stop` and `day-coords` frames build `draftItinerary` as the plan is written. `plan` means
   * the plan is interactive now — `hooks.planned` fires and the stream is still read afterward,
   * because the critique pass keeps running in the background and may still send `revised` (or
   * an `error`, once `plan` is already out — see the `error` branch below). The plain-fallback
   * path never sends any of `stop`/`day-coords`/`plan`/`revised` — only `done` (or `error`
   * before anything is interactive) — so `hooks` is optional and callers must not assume the
   * richer events arrive.
   */
  async function runStreamed<T>(
    body: Record<string, unknown>,
    hooks?: { planned?: (result: T) => void; revised?: (days: DayPlan[]) => void }
  ): Promise<T> {
    const { planned, revised } = hooks ?? {};
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
      if (!res.ok) throw new RunError(await failureFromResponse(res, "plan"));
      return (await res.json()) as T;
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
      // the whole two-minute call again immediately after the user asked it to stop. Offline, the
      // retry could only fail the same way.
      if (!shouldFallBack({ aborted: controller.signal.aborted, online: navigator.onLine })) throw e;
      return plainFallback();
    }

    // A refusal is an answer, not a dropped stream, and is never retried: a 429 or a 503 sent again
    // as a plain POST would spend the allowance a second time on a request already refused. Only a
    // stream that never opened gets the one retry (`shouldFallBack`, tested in streamRetry.test.mjs).
    if (shouldFallBack({ response: res, aborted: false, online: true })) return plainFallback();
    if (!res.ok) throw new RunError(await failureFromResponse(res, "plan"));
    const stream = res.body!;

    let result: T | null = null;
    let failure: Failure | null = null;
    // Whether a `plan` event has already landed — gates the `error` branch below (Ruling B):
    // a background-critique failure after the plan is on screen must not undo it.
    let planReceived = false;
    const onEvent = (event: string, data: string) => {
      if (event === "stage") {
        const parsed = JSON.parse(data) as StageEvent;
        setStages((prev) =>
          prev.map((s) => (s.stage === parsed.stage ? { ...s, status: parsed.status } : s))
        );
      } else if (event === "stop") {
        const { dayIndex, stopIndex, date, stop } = JSON.parse(data) as StreamedStop;
        setDraftItinerary((prev) => {
          const days = [...(prev?.days ?? [])];
          // Days arrive in order but a frame could in principle outrun its day, so grow the
          // array rather than assuming the slot exists.
          while (days.length <= dayIndex) {
            days.push({ date: "", weather: "", stops: [] });
          }
          const stops = [...days[dayIndex].stops];
          stops[stopIndex] = stop;
          // The frame carries its day's date so the day header has something to print for the
          // whole reveal — the placeholder above renders an empty date field otherwise, and the
          // day never closes until the last stop lands. `|| keep` because the frame is fail-soft:
          // a model that omitted the field sends `""`, which must not blank a date already held.
          days[dayIndex] = { ...days[dayIndex], date: date || days[dayIndex].date, stops };
          // `tier` is guaranteed set by the time generate() runs (the planner's own checks reject otherwise),
          // but it is not narrowed here, and Itinerary["tier"] is required.
          return { tier: (prev?.tier ?? tier) as Itinerary["tier"], days };
        });
      } else if (event === "day-coords") {
        const { dayIndex, coords } = JSON.parse(data) as {
          dayIndex: number;
          coords: Record<string, { lat: number; lon: number }>;
        };
        setDraftItinerary((prev) => {
          if (!prev?.days[dayIndex]) return prev;
          const days = [...prev.days];
          days[dayIndex] = {
            ...days[dayIndex],
            stops: days[dayIndex].stops.map((s) => {
              const fixed = coords[s.name.trim()];
              // `lon` on the wire, `lng` on a Stop — the two names differ and always have.
              return fixed ? { ...s, lat: fixed.lat, lng: fixed.lon } : s;
            }),
          };
          return { ...prev, days };
        });
        // Monotonic: days arrive in order, but a `Math.max` costs nothing and keeps the camera
        // from walking backwards if one ever outran another.
        setCoordsDay((prev) => (prev === null ? dayIndex : Math.max(prev, dayIndex)));
      } else if (event === "sketch") {
        // The day sketch: themes and places per day, seconds in. Seeds empty days so the headers
        // have something to say while the stops are still being written; stops fill them in place.
        const { days } = JSON.parse(data) as { days: SketchDay[] };
        setDraftItinerary((prev) => {
          const next = [...(prev?.days ?? [])];
          days.forEach((d, i) => {
            while (next.length <= i) next.push({ date: "", weather: "", stops: [] });
            next[i] = {
              ...next[i],
              date: next[i].date || d.date,
              theme: d.theme,
              summary: next[i].summary || [d.area, ...d.anchors].filter(Boolean).join(" · "),
            };
          });
          return { tier: (prev?.tier ?? tier) as Itinerary["tier"], days: next };
        });
      } else if (event === "plan") {
        // Bound to a local first: `result` is `T | null`, and TypeScript does not narrow a
        // closed-over `let` across the assignment, so passing it straight to `planned` is an
        // error.
        const plan = JSON.parse(data) as T;
        result = plan;
        planReceived = true;
        editedSincePlanRef.current = false;
        planned?.(plan);
      } else if (event === "revised") {
        const revision = JSON.parse(data) as { days: DayPlan[]; issues: string[]; tripId?: string | null };
        // With a `tripId` the server has already written the revision to the draft the plan opened
        // as, and the trip page on screen (this view has usually unmounted by now) is the one to
        // show it. Without one there was no draft row, so the plan is on the result view below.
        if (revision.tripId) {
          announceDraftRevision(revision.tripId);
        } else if (!editedSincePlanRef.current) {
          // Critique replaces the whole day set. If the traveller has touched the plan since it
          // opened, their edit is the more recent intent and the replacement is dropped — the
          // issues list is still worth having either way.
          revised?.(revision.days);
        }
      } else if (event === "done") {
        result = JSON.parse(data) as T;
      } else if (event === "error") {
        const parsed = JSON.parse(data) as { error: string; code?: string };
        // Ruling B: once `plan` is on the wire the traveler already has a working, interactive
        // itinerary. A critique-pass failure at that point is a lost background refinement, not
        // a lost trip — it must not fail the run out from under a plan already being read.
        if (planReceived) {
          console.error("[home] background review failed", parsed.error);
        } else {
          failure = failureFromStreamError(parsed, "plan");
        }
      }
    };
    // Whatever our own handling throws (a malformed frame, a bug in `planned` or `revised`) is our
    // fault, not a dropped connection: wrapped here, so only the reader's own errors stay TypeErrors.
    await readEventStream(stream, (event, data) => {
      try {
        onEvent(event, data);
      } catch (e) {
        console.error("[home] stream event failed", e);
        throw new RunError({ kind: "server" });
      }
    });

    if (failure) throw new RunError(failure);
    // The stream closed with neither a plan nor an error: the connection went, not the planner.
    if (!result) throw new RunError({ kind: "dropped" });
    return result;
  }

  async function generate() {
    // The dates were checked on the planner's own fields before this runs (PlanningFlow's
    // `validateBasics`, copy rows P-04, P-05, P-07, P-08).
    setGenerating(true);
    setError(null);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    setDraftItinerary(null);
    setCoordsDay(null);
    editedSincePlanRef.current = false;
    // Frame the destination before the wait starts. Nothing else does: the only caller of
    // `flyToTypedDestination` is the destination field's `onBlur`, and Cancel returns the
    // traveller to the *review* step, where that field is not mounted — so a Cancel-then-Generate
    // opened on the world pose with no pin for the ~40s until the first streamed stop arrived.
    // Invisible while the loader was an opaque sheet; the map is the wait now.
    // Not awaited, and cheap: `lastFlownRef` makes this a no-op on the ordinary path where the
    // blur already flew, so it costs a geocode only when something cleared that ref.
    void flyToTypedDestination();

    /**
     * Swaps from the loading view to the plan's trip page (or, when its draft row could not be
     * written, to the result view here), once. Called either from `planned`
     * the instant the stream's `plan` event lands, or — on the plain-fallback path, which never
     * sends a `plan` event at all — after `runStreamed` resolves with the final result.
     *
     * `owner` is the AbortController that was live when this call was scheduled. The arrival
     * hold below is a real wait with no fetch behind it, so a Cancel (or a fresh `generate()`
     * call) racing it isn't caught by the abort signal the way the rest of this function is —
     * checking that `owner` is still the live controller after the hold is what stops a
     * cancelled or superseded run from resurrecting itself on screen a moment later.
     */
    const showPlan = async (
      owner: AbortController | null,
      plan: Itinerary,
      runId: string | null,
      sessionId: string | null
    ) => {
      // Let the arrival land before swapping surfaces. Without this the loader unmounts the
      // instant the plan resolves, so the marker never reaches the pin and the wait ends on a
      // hard cut. Peak-end weights these few hundred milliseconds far more heavily than the
      // middle minute, and they used to be spent on nothing. ItineraryCard's own staggered
      // reveal takes over from here.
      // From here until the draft insert settles, a revision is held rather than shown.
      insertPending = true;
      await settle(ARRIVAL_HOLD_MS);
      if (abortRef.current !== owner) return;
      // Every side effect of "the plan arrived" belongs here, not after `await runStreamed(…)`.
      // That await used to resolve when the plan appeared; it now resolves when the *stream*
      // closes, ~150s later, after the background critique. Left there, the tab title and the
      // desktop Notification fired two and a half minutes into exactly the silence they exist to
      // break, and the wizard draft plus the `?step=` query param survived that whole window —
      // so a reload at t=200s restored the form and took the finished plan off screen. The
      // ownership guard above is already the "is this run still the live one" test both paths
      // need, and this funnel serves the plain fallback too.
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
      // **A finished plan opens on its trip page, as a draft.** The writing screen stays up for
      // the insert (one cached geocode and a row, well under a second) and the router then moves
      // to the page every kept trip uses: the board, the draft notice and Keep. The critique is
      // still running; its revision lands on this row server-side, and the trip page is told
      // through `announceDraftRevision` above. `writeDraft` swallows its own failures.
      let tripId = await writeDraft(plan, runId, sessionId);
      // One quiet retry before falling back: a failed insert is usually a blip, and the trip page is
      // the better place to land. Not offline, where a second try fails the same way. `draftState`
      // keeps whichever attempt ran last.
      if (!tripId && navigator.onLine && abortRef.current === owner) {
        await settle(800);
        if (abortRef.current === owner) tripId = await writeDraft(plan, runId, sessionId);
      }
      insertPending = false;
      if (abortRef.current !== owner) return;
      if (tripId) {
        // A revision that beat the insert found no row to land on (see `earlyRevision`). The row
        // holds exactly the plan just inserted and nobody has seen it yet, so it is written here,
        // through the ordinary PATCH, before the page that reads it opens. Fail-soft: the plan
        // still opens if this does not land.
        if (earlyRevision) {
          await fetch(`/api/trips/${tripId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itinerary: { ...plan, days: earlyRevision }, chatSessionId: sessionId }),
          })
            .then((r) => {
              if (!r.ok) throw new Error(`PATCH ${r.status}`);
            })
            .catch((e) => console.error("[home] early revision write failed", e));
        }
        router.push(`/trip/${tripId}`);
        return;
      }
      // No draft row, so nowhere to open it: the result step, the trip board read-only with Keep
      // (see the render). `save()` inserts the trip outright from here, and a revision lands on this
      // view. The streamed draft stays on the map until here, so the wait shows no blank map.
      setDraftItinerary(null);
      setCoordsDay(null);
      setItinerary(earlyRevision ? { ...plan, days: earlyRevision } : plan);
      setLastRunId(runId);
      setLastSessionId(sessionId);
      setBoardShut(false);
      setStep("result");
      setGenerating(false);
    };

    let planShown = false;
    /** The days as `plan` delivered them, so the `revised` hook below can say which ones the
     *  critique actually changed. Safe to compare against: `revised` only fires when nothing
     *  local has touched the plan since (see `editedSincePlanRef`), so this is still what is on
     *  screen when it does. */
    let plannedDays: DayPlan[] | null = null;
    /** Set while `showPlan` holds the arrival and waits for the draft insert. A revision arriving then has no row to land
     *  on server-side (the frame comes without a `tripId`) and no view to land on either, so it is
     *  held in `earlyRevision` for `showPlan` to apply once the insert settles. The critique takes
     *  minutes and the insert well under a second, so this is a guard against a drop rather than a
     *  path anyone is expected to take. */
    let insertPending = false;
    let earlyRevision: DayPlan[] | null = null;
    try {
      const data = await runStreamed<{
        itinerary: Itinerary;
        runId?: string | null;
        sessionId?: string | null;
      }>(
        {
          destination,
          startDate,
          endDate,
          budget,
          tier,
          preferences: { tags: interests, vibe: null },
          userAnswers: currentAnswers(),
          dietary,
        },
        {
          planned: (plan) => {
            planShown = true;
            plannedDays = plan.itinerary.days;
            void showPlan(abortRef.current, plan.itinerary, plan.runId ?? null, plan.sessionId ?? null);
          },
          revised: (days) => {
            if (insertPending) {
              earlyRevision = days;
              return;
            }
            // A day set swapped out silently under someone mid-read is the startling outcome the
            // spec's Risk 3 named. Reuse the dot the chat already uses for "this day changed while
            // you were looking elsewhere" rather than inventing a second indicator.
            const changed = changedDayNumbers(plannedDays, days);
            setItinerary((prev) => (prev ? { ...prev, days } : prev));
            if (changed.length) {
              setUnseenChangedDays((prev) => markUnseenDays(changed, activeDayRef.current, prev));
            }
          },
        }
      );
      // The plain-fallback path never sends a `plan` event, so `planned` never ran — this is
      // the only place the result reaches the screen. On the streaming path `planned` has
      // already handled it (`done` here just confirms what `plan` already delivered, possibly
      // critiqued in the background), so this is a no-op.
      if (!planShown) {
        await showPlan(abortRef.current, data.itinerary, data.runId ?? null, data.sessionId ?? null);
      }

      // Deliberately no profile write here. The preferences step's values are a per-trip
      // override, and writing them back would silently make one unusual trip the traveler's
      // permanent default — the bug this codebase already hit twice with `tier`. /profile and
      // the welcome are the only writers.
    } catch (e) {
      // Same reason as in cancelGeneration: a run that failed halfway leaves whatever stops it
      // got in `draftItinerary`, and that value is now on screen. Cleared for the abort case too
      // — cancelGeneration has already done it, but a `plainFallback` abort can land here without
      // having gone through that button.
      setDraftItinerary(null);
      setCoordsDay(null);
      // Same wipe as cancelGeneration, and gated on `planShown` rather than on `step`: `step` here
      // is this closure's stale copy from the click, while `runStreamed` can genuinely throw
      // *after* `plan` landed (a socket dropping during the background critique). Wiping the map
      // then would take the finished plan's own route off the globe.
      // Paired with `resetToHome`, always: flying home and leaving `lastFlownRef` latched on the
      // destination means the retry after a failure opens on the world pose, which is the same
      // defect cancelGeneration fixes on its own path.
      if (!planShown) {
        resetToHome();
        lastFlownRef.current = "";
      }
      // A cancel arrives here as an AbortError. It is not a failure and must not be reported
      // as one — cancelGeneration has already reset the UI.
      if (!isAbort(e)) {
        // Ruling B again, on the *thrown* path this time. `runStreamed` doesn't only fail a run
        // by receiving an `error` frame — `readEventStream` rejects on a dropped socket, and a
        // `JSON.parse` throw on a malformed `revised` frame propagates out of `onEvent`. Either
        // can land here long after `plan`, with a working, editable, already-persisted plan on
        // screen. Telling that traveller we couldn't build their itinerary would be a lie about
        // the thing they are looking at.
        if (planShown) {
          console.error("[home] background review failed", e);
        } else {
          const f = runFailureOf(e);
          if (f.kind === "rate_limited") {
            // Copy rows P-37, P-37a: a toast that counts the hold down while "Plan my trip" waits.
            holdFromFailure(f);
            showError({
              title: "You’ve planned 3 trips in the last 10 minutes, which is the limit.",
              detail: "Your answers are kept. You can plan another in {mm:ss}.",
              hold: f.bucket,
              resolved: { title: "You can plan another trip now." },
            });
          } else {
            setError({ text: planFailureText(f, destination) });
          }
          notifyGenerationDone(false, notifyOnDone, causeShort(f));
        }
      }
    } finally {
      setGenerating(false);
    }
  }

  /** A changed plan from outside this tree — the map search adding a stop (`usePublishItinerary`
   *  above). Local state only: with no trip row there is nothing to persist to until save() runs.
   *  The name is older than its job: it carried the result card's drag-and-drop when that card
   *  was on this view. */
  function handleRearrange(next: Itinerary) {
    // A local edit outranks a critique revision that lands after it — see editedSincePlanRef.
    editedSincePlanRef.current = true;
    setItinerary(next);
  }

  /**
   * Writes the just-generated plan to its own `draft` row.
   *
   * **Fail-soft, and deliberately silent on failure.** This runs in the seconds after a
   * two-minute wait finally paid off; an error block at that moment would report a problem the
   * traveler did not cause and cannot act on, about a plan that is on screen and working. The
   * failure is logged, surfaced as one quiet line beside Keep on the result board, and `save()`
   * inserts the trip outright — so the worst case is the behaviour this whole feature replaced.
   *
   * Returns the new id (or null) so `showPlan` can open it.
   */
  async function writeDraft(
    plan: Itinerary,
    runId: string | null,
    sessionId: string | null
  ): Promise<string | null> {
    setDraftState("pending");
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          startDate,
          endDate,
          budget,
          itinerary: plan,
          runId,
          chatSessionId: sessionId,
          userAnswers: currentAnswers(),
          status: "draft",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save draft");
      setDraftState("saved");
      return data.id as string;
    } catch (e) {
      console.error("[home] draft save failed", e);
      setDraftState(failureFromThrown(e).kind === "offline" ? "offline" : "failed");
      return null;
    }
  }

  async function save() {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      // Only the result board calls this, and it exists only when the plan has no draft row (both
      // inserts failed, see `showPlan`), so keeping it inserts the trip outright — the behaviour this
      // page had before drafts existed.
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
      if (!res.ok) throw new RunError(await failureFromResponse(res, "edit"));
      const data = await res.json();
      router.push(`/trip/${data.id}`);
    } catch (e) {
      setError({ text: keepFailureText(runFailureOf(e), itinerary) });
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

  /** Forward one step: what the old form's submit did, unchanged. Basics warms the context and
   *  trip-fetch bundles in the background; review generates. */
  function advancePlan() {
    if (planStep === "basics") {
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
      setRawFetchFailed(false);
      fetch("/api/trip-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate }),
      })
        .then((r) => r.json())
        .then((data) => {
          setRawFetch(data.rawFetch ?? null);
          setRawFetchFailed(!data.rawFetch);
        })
        .catch(() => setRawFetchFailed(true))
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
  }

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
      // Each guarded independently, because a partial prefill must leave everything it did not
      // ask about exactly as the traveller's saved profile left it. See PlanPrefill for why the
      // three money/party fields are optional rather than defaulted at the call site.
      if (prefill.budgetUsd !== undefined) setBudget(prefill.budgetUsd);
      if (prefill.adults !== undefined || prefill.children !== undefined) {
        const adults = prefill.adults ?? 1;
        const children = prefill.children ?? 0;
        setParty({ adults, children, infants: 0 });
        setGroup(children > 0 ? "family_with_kids" : adults === 1 ? "solo" : "couple");
      }
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

  // Everything the planner page shows or changes. Answers stay in this component's state (the
  // draft snapshot, the history entries and generate() all read them); this is only how they reach it.
  const plannerModel: PlannerModel = {
    step: planStep,
    onJump: goToStep,
    onNext: advancePlan,
    onBack: () => window.history.back(),
    error: error?.text ?? null,
    destination,
    setDestination: (v) => {
      setDestination(v);
      setDestinationMissed(false);
    },
    onDestinationPick: (s) => {
      // The field now holds the picked label, so its next blur must not geocode it again.
      lastFlownRef.current = suggestionLabel(s);
      flyToDestinationByCoords(s.lat, s.lon, s.name);
    },
    onDestinationBlur: () => void flyToTypedDestination(),
    destinationMissed,
    coords: destinationCoords,
    startDate,
    endDate,
    setDates: (start, end) => {
      setStartDate(start);
      setEndDate(end);
    },
    budget,
    setBudget,
    budgetBasis,
    setBudgetBasis,
    tier,
    party,
    setParty,
    arrivalTime,
    setArrivalTime,
    arrivalPoint,
    setArrivalPoint,
    departureTime,
    setDepartureTime,
    departurePoint,
    setDeparturePoint,
    arrivalOptions: arrivalPointOptions,
    stayBooked,
    setStayBooked,
    anchors,
    setAnchors,
    group,
    pickGroup,
    groupOther,
    setGroupOther,
    dietary,
    setDietary,
    interests,
    toggleInterest,
    starredInterests,
    toggleInterestStar,
    pace,
    setPace,
    discovery,
    setDiscovery,
    energy,
    setEnergy,
    crowds,
    setCrowds,
    accessibility,
    setAccess,
    purpose,
    setPurpose,
    mustInclude,
    setMustInclude,
    avoid,
    setAvoid,
    constraintsNote,
    setConstraintsNote,
    pois: rawFetch?.candidatePois.pois ?? [],
    poisAvailable: rawFetch?.candidatePois.available ?? false,
    poisFailed: rawFetchFailed,
    poisLoading: rawFetchLoading,
    selectedPois,
    togglePoi,
    customPois,
    addCustomPoi,
    removeCustomPoi,
    notify: notifyOnDone,
    onNotifyToggle: (checked) => void handleNotifyToggle(checked),
    notifyBlocked,
  };

  return (
    <main
      // pt-[calc(var(--nav-h)+1.25rem)]: clearance for the fixed glass navbar (AppShell
      // renders Navbar on every route). The extra top padding is what PolarLanding's negative
      // top margin cancels — see the note on that component's wrapper.
      // `map-chrome-hidden` hides the control stack *and* `.stop-marker-layer` (globals.css), on
      // the grounds that the wizard's steps are a form over a decorative globe with no route on
      // it. Both halves of that stop being true the moment Generate is pressed: there is a route
      // now, arriving stop by stop, and the marker cards are what the traveller is watching. So a
      // generating run is neither a form step nor a result — it keeps the markers without taking
      // `dashboard-page`'s token overrides, which belong to the solid-background result view.
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)] ${!preResult ? "dashboard-page" : generating ? "" : "map-chrome-hidden"}`}
    >
      {/* No SceneBackdrop here any more: the planner page draws its own stage (the place's photograph,
          or the night over Wadi Rum) behind every step. */}

      {/* Gated here rather than left to the component's own `if (!active) return null`. It is
          behind a dynamic() boundary now, and an unconditionally-rendered dynamic component
          fetches its chunk on first render — i.e. on the landing, which is the one thing the
          boundary exists to prevent. */}
      {/* A generate is written on the live map under the Polar screen (the canvas design "Live map,
          writing the plan · C Monument"). */}
      {generating && (
        <WritingThePlan
          stages={stages}
          facts={destinationFacts}
          destination={destination}
          coords={destinationCoords}
          dateRange={startDate && endDate ? formatDateRange(startDate, endDate) : null}
          tripDays={days}
          tierName={TIERS.find((t) => t.id === tier)?.name ?? null}
          budget={budget}
          rawFetch={rawFetch}
          draft={draftItinerary}
          onCancel={cancelGeneration}
        />
      )}

      {/* The Polar Interior landing: a destination hero, sample plans, a day on a night map, what a
          plan knows, and a closing form. Full-bleed sections with real scroll height, handing off
          through the same startPlanning as before — every "plan" on it opens this app's own
          multi-step form, prefilled where the landing knows what to fill. */}
      {step === "landing" && <PolarLanding onPlan={startPlanning} />}

      {/* The planner (src/components/polar/planner), from the canvas design "TripMate Planning flow
          (web)": four steps over the place being planned. Full-bleed like PolarLanding, so it cancels
          this <main>'s padding the same way. Every answer still lives here; `plannerModel` is how it
          reaches the page. Gone while a plan is written: the live map and WritingThePlan take the
          screen. */}
      {step === "plan" && !generating && (
        <div className="-mx-5 -mb-5 -mt-[calc(var(--nav-h)+1.25rem)] sm:-mx-6 sm:-mb-6 sm:-mt-[calc(var(--nav-h)+1.5rem)]">
          <PlanningFlow model={plannerModel} />
        </div>
      )}

      {/* The result step, reached only when the draft insert failed twice (`showPlan`): the trip
          page's board with nothing that needs a trip row — read the plan, switch days, Keep it. The
          note under Keep says why it isn't saved (W-16/W-17), then why Keep failed (W-11..W-15).
          `.trip-page` gives it the trip page's map chrome and pointer rules (globals.css). */}
      {step === "result" && itinerary && (
        <div className="trip-page">
          <BoardInsets shape={boardShut ? "ticket" : "board"} />
          <TripBoard
            trip={{ id: "", destination, startDate, endDate, budget, itinerary, status: "draft" }}
            itinerary={itinerary}
            dayIndex={activeDayIndex}
            onDayChange={(next) => {
              setActiveDayIndex(next);
              setUnseenChangedDays((prev) => clearUnseenDay(prev, next));
            }}
            shape={boardShut ? "ticket" : "board"}
            unseenChangedDays={unseenChangedDays}
            drawerOpen={false}
            onSelectStop={noop}
            onRefine={noop}
            onEdit={noop}
            onFitAnchor={noop}
            onShut={() => setBoardShut(true)}
            onOpen={() => setBoardShut(false)}
            onKeep={save}
            keeping={saving}
            keepNote={error?.text ?? draftFailedNote(draftState)}
            costNote={null}
            onRetryCost={noop}
            onShareChange={noop}
            onLodgingActualCost={noop}
            overspend={null}
            unsaved
          />
        </div>
      )}

      {/* Mounted only while a generation streams, because the card inside it — kept mounted rather
          than unmounted, see DockedPanel — runs its `showTripRoute` effect on every arriving stop, so
          the route and the marker cards build themselves on the live map behind the foot band. It is
          not *shown*: the writing screen is the wait's own surface, and a finished plan opens on its
          trip page, so the old capsule over the map was only ever a second, stale itinerary (Zaid,
          2026-10-17). `invisible` rather than `hidden`, so the panel keeps its geometry and the
          camera frames exactly as it did; `inert` so nothing in it takes focus. Never on the result
          step, which is the board above: two route drivers would fight over the camera (`generating`
          is false there; `showPlan` drops it in the same batch). Shut to its capsule, and the card
          told so: the whole trip so far on the map, no day singled out. */}
      {generating && shownItinerary && (
        <div className="invisible pointer-events-none" inert>
          <DockedPanel
            collapsible
            collapsed
            // What the capsule carries while the panel is shut. There is no trip row yet, so this
            // reads the form's own destination.
            capsule={
              destination
                ? {
                    title: destination,
                    ...capsuleDays({ days: shownItinerary.days, streaming: true, tripDays: days, activeDayIndex }),
                  }
                : undefined
            }
          >
            {/* Read-only (no `editable`, no `onItineraryChange`): the next streamed stop would
                overwrite any edit. */}
            <ItineraryCard
              itinerary={shownItinerary}
              budget={budget}
              destination={destination}
              onSelectStop={noop}
              activeDayIndex={activeDayIndex}
              panelCollapsed
            />
          </DockedPanel>
        </div>
      )}
    </main>
  );
}
