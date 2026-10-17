"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { DayEditUpdates } from "@/components/DayHeader";
import { fitMessage } from "@/components/AnchorReceipt";
import FeedbackLoop, { type DraftState } from "@/components/FeedbackLoop";
import { DEFAULT_PARTY } from "@/components/PartyCounter";
import {
  legacyExplorerStyle,
  sanitizeNamedList,
  travelStyleOf,
} from "@/lib/userAnswers";
import type { SuggestOption } from "@/components/SuggestInput";
import { useFocusEdit } from "@/lib/useFocusEdit";
import { usePublishItinerary } from "@/lib/activeItinerary";
import PolarLanding from "@/components/polar/PolarLanding";
import PlanningFlow, { type PlannerModel } from "@/components/polar/planner/PlanningFlow";
import { suggestionLabel } from "@/lib/weather";
import { setHomeScreen } from "@/lib/homeScreen";
import type { PlanPrefill } from "@/lib/planExamples";
import DockedPanel from "@/components/DockedPanel";
import { useStoryControls } from "@/lib/storyMode";
import { PlayIcon } from "@/components/icons";
import ErrorNote from "@/components/ErrorNote";
import OnboardingCard from "@/components/OnboardingCard";
import { backPillClass } from "@/components/BrandMark";
import { capsuleDays } from "@/lib/planProgress";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, perPersonBudget, tripDays, TierId, TIERS } from "@/lib/tiers";
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
import { upcomingStopsAfter } from "@/lib/itinerary";
import type { ArrivalPoint } from "@/lib/arrivalPoints";
import { devLabel } from "@/lib/devInspector";
import { clearUnseenDay, changedDayNumbers, markUnseenDays } from "@/lib/unseenChanges";
import { NO_ACCESSIBILITY_NEEDS } from "@/lib/travelerProfile";
import type { TravelerProfile, DietaryNeeds } from "@/lib/travelerProfile";
import { readEventStream } from "@/lib/eventStream";
import { STAGE_ORDER, StageEvent } from "@/lib/generationStages";
import type { StageProgress } from "@/lib/generationStages";
import { buildDestinationFacts } from "@/lib/destinationFacts";
import { formatDateRange } from "@/lib/format";
import { usePlacePhoto } from "@/lib/usePlacePhoto";

/* Five `next/dynamic` boundaries, the same `{ ssr: false }` idiom AppShell uses for the globe.
   None of these renders on the landing step — the landing renders `<PolarLanding>` and nothing
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
   there is a form with no destination input. `PolarLanding` static is the whole point. */
const ItineraryCard = dynamic(() => import("@/components/ItineraryCard"), { ssr: false });
const FocusEditMode = dynamic(() => import("@/components/FocusEditMode"), { ssr: false });
const PlaceDetailPanel = dynamic(() => import("@/components/PlaceDetailPanel"), { ssr: false });
// Behind its own boundary like every other blue-hour piece: it is only ever on stage during the
// plan step, and its two crops should not be fetched by a traveller who never opens the form.
const GenerationScreen = dynamic(() => import("@/components/GenerationScreen"), {
  ssr: false,
});
// Behind its own boundary for the same reason: it is only on stage while a plan is being written.
const WritingThePlan = dynamic(() => import("@/components/polar/WritingThePlan"), { ssr: false });

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

/** How long an edit on the pre-save result view sits before it is written back to the draft row.
 *
 *  Every local edit here — a drag on the board, a retimed day, an inline cost — used to be state
 *  only, and drag-and-drop fires a new itinerary object on every drop. Writing each one straight
 *  through would mean a PATCH per drop for a row nobody has committed to yet, so edits are
 *  coalesced: the timer restarts on each change and only the settled plan is persisted. Short
 *  enough that a traveler who rearranges a day and immediately hits Back has already been saved
 *  — which is the entire point of the draft. */
const DRAFT_AUTOSAVE_MS = 1200;

/** The draft row's edit write, shared by the coalescing timer and the leave-now flush below so
 *  the two cannot send different bodies. `keepalive` lets the request outlive the document, which
 *  is the whole point of the flush — a normal fetch fired during unload is cancelled with it. */
function patchDraft(
  tripId: string,
  plan: Itinerary,
  sessionId: string | null,
  keepalive = false
): Promise<Response> {
  return fetch(`/api/trips/${tripId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itinerary: plan, chatSessionId: sessionId }),
    keepalive,
  });
}

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
    // Half a plan is not a plan. The draft used to be safe to leave lying around because nothing
    // rendered it; it is the card and the map's route now, so a cancelled run would otherwise
    // leave a partial itinerary on screen — and, on a refine, sitting *over* the finished plan it
    // was meant to replace — until the next run happened to reset it.
    setDraftItinerary(null);
    setCoordsDay(null);
    // Clearing the draft unmounts the card, and the card is the only thing that calls
    // `showTripRoute` — so on a *generate* there is nothing left to redraw the map, and the
    // half-drawn route and its pins would sit on the globe until something else wiped them (the
    // form's own backdrop hides them, but the next Generate uncovers them again). A refine needs
    // the opposite: the finished plan is still there, its card re-renders from it, and its own
    // route effect puts the real geometry back.
    if (step !== "result") resetToHome();
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
  // the most recent generate/refine call so save() can attach it to the
  // trip, letting later place-detail calls append to that same run.
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  // The CLI session the generate call ran in. Handed to the edit chat so refinement continues
  // that same conversation, and saved with the trip so it survives a reload. Null whenever the
  // session is unknown or gone — every consumer treats that as "rebuild the full prompt".
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  /**
   * The `trips` row this plan already lives in, written as a `draft` the moment the generation
   * landed — and the fix for the way this page used to lose work.
   *
   * A generated itinerary was React state and nothing else until Save ran, so a Back press, a
   * reload or a closed tab discarded a two-minute model call with no way to get it back. It now
   * has a row from the moment it exists; `Keep this trip` promotes that row rather than inserting
   * a second one, which is what keeps the plan's chat session, its `generations` link and any
   * pre-save edits attached to the trip the traveler ends up with.
   *
   * Null means there is no draft to promote — the write hasn't landed yet, or it failed. `save()`
   * falls back to a plain insert in that case, exactly as it behaved before drafts existed.
   */
  const [draftTripId, setDraftTripId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<DraftState>(null);
  /** The in-flight draft insert, so a Save pressed in the first moments after arrival waits for
   *  the id instead of racing it and inserting a duplicate row. */
  const draftWriteRef = useRef<Promise<string | null> | null>(null);
  /** The edit that is waiting out the coalescing timer, if any — the flush effect's only input.
   *  Holds the trip id and session alongside the plan so it stays a complete, self-contained
   *  request even if `draftTripId` has since moved on. */
  const pendingDraftRef = useRef<{
    tripId: string;
    plan: Itinerary;
    sessionId: string | null;
  } | null>(null);
  /** The exact itinerary object last written to the draft row. Compared by reference, not by
   *  value: every edit path here produces a fresh object (`structuredClone`, `moveStop`), so
   *  identity is a sound "has this changed" test and costs nothing — where a deep compare of a
   *  whole plan would run on every keystroke. Its job is to stop the autosave effect from
   *  re-PATCHing the plan the insert just stored. */
  const persistedDraftRef = useRef<Itinerary | null>(null);
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
  // Story mode, for the capsule's Play button. One film at a time, owned by the app rather than
  // by this page (`storyMode.tsx`) — so this and the card's own Play button are one control
  // reached from two places.
  const story = useStoryControls();
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [notifyOnDone, setNotifyOnDone] = useState(false);
  const [notifyBlocked, setNotifyBlocked] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>(
    STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const }))
  );
  /** The plan as it is being written, assembled from `stop` and `day-coords` frames. Null
   *  outside a generation or a refine — both drive the same `stop`/`day-coords`/`plan` events
   *  off the one `runStreamed`, so both reset this to null at the start and clear it once their
   *  own plan lands. This is what the map and the itinerary card render during the wait — there
   *  is no separate loading view to keep in sync with it. */
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
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  /** 0-based days a chat turn changed while the traveler was reading a different one. Owned here
   *  rather than in the card because the chat that produces them lives beside it, not inside it. */
  const [unseenChangedDays, setUnseenChangedDays] = useState<number[]>([]);
  /** The day on screen, readable from a closure that has been alive for minutes. `generate()`'s
   *  `revised` hook runs ~150s after the click and needs to know which tab the traveller is on
   *  *now* — its captured `activeDayIndex` is the value from the click and would mark a dot on
   *  the very day they are reading. */
  const activeDayRef = useRef(0);
  useEffect(() => {
    activeDayRef.current = activeDayIndex;
  }, [activeDayIndex]);
  /** True from the moment the plan is interactive until the stream closes — i.e. exactly while
   *  the background critique is still running over a plan the traveller can already read. The
   *  band is gone by then (`showPlan` drops `generating`), so this is what tells them a change
   *  may still arrive. Generate-only: a refine keeps `refining` true through its own critique
   *  and keeps the band up instead. */
  const [reviewing, setReviewing] = useState(false);
  // Step 7 edit session. `chatScope` null = closed; { dayIndex: null } = whole trip.
  const focus = useFocusEdit(itinerary);
  // Publishes the plan to surfaces mounted outside this tree — the map's search control, which
  // lives with the map chrome in `AppShell`. Same commit path the result card's own drag-and-drop
  // uses, so a café added from the map is saved exactly like a dragged stop.
  usePublishItinerary(itinerary, handleRearrange);
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
  const { resetToHome, showTripRoute, setRouteConnectorsHidden, setNightLens } = useMapCamera();
  // The camera for the length of a run. Holds `showTripRoute`'s own per-stop framing and moves
  // once per day instead, when that day's real coordinates land — see `useStreamingCamera`.
  useStreamingCamera(generating || refining, draftItinerary, coordsDay);

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

  // The night lens for the length of a generate (WritingThePlan's ground), lifting as the plan opens.
  // A refine runs from the result view on the day map, so it is not lit. Off on the way out, too.
  const nightLens = generating && !refining;
  useEffect(() => {
    setNightLens(nightLens);
  }, [nightLens, setNightLens]);
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
   * **`itinerary` is only a fallback on the result step, and that condition is load-bearing.**
   * Nothing clears `itinerary` when a traveller presses Back and plans a second trip — the page
   * never unmounts between the two — so before this branch existed, pressing Generate for
   * Reykjavik put *Kyoto's* finished plan and route on screen for the ten seconds until the first
   * real stop arrived. A generate has nothing to fall back to by definition; a refine, which runs
   * from the result step, falls back to the plan it is reworking, which is exactly right.
   *
   * Read only where the question is "what is being shown": the card, the capsule's day count, and
   * the gate below. Everything that *edits* or *saves* still reads `itinerary`, because a draft is
   * not a plan anybody can keep yet.
   */
  const shownItinerary = step === "result" ? (draftItinerary ?? itinerary) : draftItinerary;

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

  /** True exactly while the card is showing a half-written plan. Preferred over `generating` for
   *  gating the card's own controls: the two come apart at both ends of a run — `generating` is
   *  true for the ten-odd seconds before the first stop arrives, and stays true through the
   *  background critique after the plan is interactive — and it is the *draft* that makes an edit
   *  or a narrated film a bad idea, not the run. */
  const streamingPlan = draftItinerary !== null;

  const { prefetch: warmStory } = story;

  /**
   * Warm the narration for the day on screen, so pressing Play starts a film instead of a wait.
   *
   * One day, not all of them: `MAX_TRIP_DAYS` is 30 and the CLI transport spawns a subprocess per
   * call, so warming a whole trip would be half an hour of serialised Sonnet for films nobody has
   * asked for. The dwell that stops a click along the day tabs from warming every one of them
   * lives in `story.prefetch`.
   *
   * `step === "result"` is the same guard the Play button carries, for the same reason: nothing
   * clears `itinerary` when a traveller presses Back and plans a second trip (see
   * `shownItinerary` above), so without it, filling in the wizard for Reykjavik would warm Kyoto's
   * day one against Reykjavik's `destination` — a script belonging to neither trip.
   *
   * `itinerary` rather than `shownItinerary`, and `!streamingPlan` beside it: this file already
   * draws that line two lines up — it is the *draft* that makes a narrated film a bad idea, not
   * the run. A half-written day is a call keyed on stops that are about to change.
   *
   * The dependency is the **destructured** `prefetch`, not `story`: the controls object changes
   * identity when a film starts, pauses and ends, and depending on the whole of it would re-arm
   * the warm mid-playback. `exhaustive-deps` will not accept the member expression, so it is
   * pulled out into a local — which is stable by construction, being a `useCallback([])`.
   *
   * ponytail: the background critique can still revise a day ~150s after the plan lands
   * (`reviewing`), which changes the key and wastes this call. Gating on `!reviewing` would delay
   * the warm past the window it exists to serve; one occasionally-wasted cheap call is the price.
   */
  useEffect(() => {
    if (step !== "result" || streamingPlan || !itinerary) return;
    // Clamped the way `ItineraryCard` clamps it. A chat turn that removes days leaves
    // `activeDayIndex` past the end for a render, and an unclamped warm there fetches a key no
    // Play button will ever ask for.
    const dayIndex = Math.min(activeDayIndex, itinerary.days.length - 1);
    if (!itinerary.days[dayIndex]?.stops.length) return;
    warmStory({ itinerary, dayIndex, destination });
  }, [step, streamingPlan, itinerary, activeDayIndex, destination, warmStory]);

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
      return `Trips over ${MAX_TRIP_DAYS} days aren't supported. Please choose a shorter date range.`;
    }
    return null;
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
        { body: ok ? "Click to view your trip." : "Something went wrong. Tap to try again." }
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
    // Whether a `plan` event has already landed — gates the `error` branch below (Ruling B):
    // a background-critique failure after the plan is on screen must not undo it.
    let planReceived = false;
    await readEventStream(res.body, (event, data) => {
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
          // `tier` is guaranteed set by the time generate() runs (validate() rejects otherwise),
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
        const revision = JSON.parse(data) as { days: DayPlan[]; issues: string[] };
        // Critique replaces the whole day set. If the traveller has touched the plan since it
        // opened, their edit is the more recent intent and the replacement is dropped — the
        // issues list is still worth having either way.
        if (!editedSincePlanRef.current) revised?.(revision.days);
      } else if (event === "done") {
        result = JSON.parse(data) as T;
      } else if (event === "error") {
        const parsed = JSON.parse(data) as { error: string };
        // Ruling B: once `plan` is on the wire the traveler already has a working, interactive
        // itinerary. A critique-pass failure at that point is a lost background refinement, not
        // a lost trip — it must not fail the run out from under a plan already being read.
        if (planReceived) {
          console.error("[home] background review failed", parsed.error);
        } else {
          failure = parsed.error;
        }
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
     * Swaps from the loading view to the interactive plan, once. Called either from `planned`
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
      setDraftItinerary(null);
      setCoordsDay(null);
      // Cleared in the same tick as the new itinerary, and that pairing matters: leaving the
      // previous run's id in place for even one render would point the autosave effect at the
      // old draft row and overwrite the plan it holds with this new one. Both updates batch, so
      // the effect never sees the new plan beside the old id.
      setDraftTripId(null);
      setDraftState(null);
      persistedDraftRef.current = null;
      draftWriteRef.current = null;
      setItinerary(plan);
      setLastRunId(runId);
      setLastSessionId(sessionId);
      setRevealAnimation(true);
      setStep("result");
      setGenerating(false);
      // Not awaited. The plan is already on screen and the traveler can read, edit or refine it
      // while this lands; blocking the arrival on a database insert would add a pause to the one
      // moment of this flow that should feel instant. `writeDraft` swallows its own failures, so
      // there is nothing here to catch — the promise is kept only so `save()` can await it.
      draftWriteRef.current = writeDraft(plan, runId, sessionId);
    };

    let planShown = false;
    /** The days as `plan` delivered them, so the `revised` hook below can say which ones the
     *  critique actually changed. Safe to compare against: `revised` only fires when nothing
     *  local has touched the plan since (see `editedSincePlanRef`), so this is still what is on
     *  screen when it does. */
    let plannedDays: DayPlan[] | null = null;
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
            // The plan is interactive but the run is not over — the critique is still reading it.
            setReviewing(true);
            void showPlan(abortRef.current, plan.itinerary, plan.runId ?? null, plan.sessionId ?? null);
          },
          revised: (days) => {
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
      // the onboarding card are the only writers.
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
          setError(errorMessage(e, "We couldn't build your itinerary. Try generating again."));
          notifyGenerationDone(false, notifyOnDone);
        }
      }
    } finally {
      setGenerating(false);
      setReviewing(false);
    }
  }

  async function refine(feedback: string) {
    setRefining(true);
    setError(null);
    setStages(STAGE_ORDER.map((stage) => ({ stage, status: "pending" as const })));
    // `runStreamed` drives the same `stop`/`day-coords`/`plan` events for a refine as for a
    // from-scratch generate (the server's `live` sink isn't gated by which one this is), so a
    // refine gets its own progressive reveal too — and needs the same clean start.
    setDraftItinerary(null);
    setCoordsDay(null);
    editedSincePlanRef.current = false;
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
      setDraftItinerary(null);
      setCoordsDay(null);
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
      setLastSessionId(data.sessionId ?? null);
    } catch (e) {
      // "Your current plan is unchanged" has to be true on screen as well as in state. The draft
      // is what the card renders while a refine streams, so leaving it here would show the
      // traveller the abandoned half-rework under a message telling them nothing changed.
      setDraftItinerary(null);
      setCoordsDay(null);
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
    // A local edit outranks a critique revision that lands after it — see editedSincePlanRef.
    editedSincePlanRef.current = true;
    setItinerary(next);
  }

  function handleEditDay(dayIndex: number, updates: DayEditUpdates) {
    if (!itinerary) return;
    const updated: Itinerary = structuredClone(itinerary);
    Object.assign(updated.days[dayIndex], updates);
    // A local edit outranks a critique revision that lands after it — see editedSincePlanRef.
    editedSincePlanRef.current = true;
    setItinerary(updated);
  }



  /**
   * Writes the just-generated plan to its own `draft` row.
   *
   * **Fail-soft, and deliberately silent on failure.** This runs in the seconds after a
   * two-minute wait finally paid off; an error block at that moment would report a problem the
   * traveler did not cause and cannot act on, about a plan that is on screen and working. The
   * failure is logged, surfaced as one quiet line in the footer beside Keep, and `save()` still
   * has its insert path — so the worst case is the behaviour this whole feature replaced.
   *
   * Returns the new id (or null) so `save()` can await an insert still in flight.
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
      // The ref before the state, and in that order. Setting `draftTripId` is what arms the
      // autosave effect below; if the ref were still null when it re-ran, it would immediately
      // PATCH back the very itinerary this insert just stored.
      persistedDraftRef.current = plan;
      setDraftTripId(data.id);
      setDraftState("saved");
      return data.id as string;
    } catch (e) {
      console.error("[home] draft save failed", e);
      setDraftState("failed");
      return null;
    }
  }

  /**
   * Keeps the draft row level with the plan on screen.
   *
   * One effect rather than a PATCH at each of the four edit sites (refine, drag, day edit, stop
   * cost): they all land in the same `itinerary` state, so watching that state catches every one
   * of them — including any added later, which is the failure mode a per-site call has.
   *
   * `lastSessionId` is a dependency because a refine replaces the conversation the plan was
   * written in, and a promoted trip whose row still points at the generate-only session opens its
   * chat having forgotten the rework. Both change in the same tick, so this is still one write.
   */
  useEffect(() => {
    if (!draftTripId || !itinerary) {
      pendingDraftRef.current = null;
      return;
    }
    if (persistedDraftRef.current === itinerary) {
      pendingDraftRef.current = null;
      return;
    }
    const snapshot = itinerary;
    // Recorded before the timer, not inside it: between an edit and the write there is a window
    // where the traveler can leave, and this is what the flush below sends if they do.
    pendingDraftRef.current = { tripId: draftTripId, plan: snapshot, sessionId: lastSessionId };
    const timer = setTimeout(() => {
      patchDraft(draftTripId, snapshot, lastSessionId)
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          // Only on success, so a failed write is retried by the next edit rather than being
          // recorded as persisted.
          persistedDraftRef.current = snapshot;
          pendingDraftRef.current = null;
          setDraftState("saved");
        })
        .catch((e) => {
          console.error("[home] draft autosave failed", e);
          setDraftState("failed");
        });
    }, DRAFT_AUTOSAVE_MS);
    // Restarted on every change, which is what coalesces a run of drags into one write.
    return () => clearTimeout(timer);
  }, [itinerary, draftTripId, lastSessionId]);

  /**
   * Sends a pending edit immediately when the page is going away.
   *
   * Without this, the coalescing window above is a hole exactly the shape of the bug this feature
   * exists to close: rearrange a day, press Back inside 1.2s, and the write is cancelled with the
   * timer. `pagehide` covers a closed tab, a reload and a back/forward-cache freeze; the cleanup
   * covers a client-side route change, which unmounts this view without any of those firing.
   *
   * Reads only refs and declares no dependencies on purpose — it must subscribe once, not re-run
   * on every keystroke, and the ref always holds the latest unwritten plan.
   */
  useEffect(() => {
    const flush = () => {
      const pending = pendingDraftRef.current;
      if (!pending) return;
      pendingDraftRef.current = null;
      // Fire-and-forget by definition: nothing is left to render the outcome to. A rejection here
      // is not even reportable, so it is swallowed rather than left as an unhandled rejection.
      patchDraft(pending.tripId, pending.plan, pending.sessionId, true).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  async function save() {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      // Await the draft insert rather than racing it. Without this, a Save pressed in the first
      // moment after arrival reads `draftTripId` as null and falls through to the insert below —
      // two rows for one plan, one of which nobody opens again.
      const draftId = draftTripId ?? (draftWriteRef.current ? await draftWriteRef.current : null);

      // The ordinary path: the plan is already a row, so keeping it is a promotion. It carries the
      // current itinerary too, which both flushes an edit the autosave timer hasn't written yet and
      // makes the status flip and the plan it applies to one atomic request.
      if (draftId) {
        const res = await fetch(`/api/trips/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itinerary, chatSessionId: lastSessionId, status: "saved" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to save trip");
        // This request carried the itinerary, so there is nothing pending any more — recorded
        // before the navigation so the unmount flush doesn't re-send a plan that just saved.
        persistedDraftRef.current = itinerary;
        pendingDraftRef.current = null;
        router.push(`/trip/${draftId}`);
        return;
      }

      // No draft to promote, because its write failed (or never ran). Inserts the trip outright —
      // the behaviour this page had before drafts existed, kept as the fallback so a draft outage
      // costs the traveler nothing.
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

  /** Forward one step: what the old form's submit did, unchanged. Basics warms the context and
   *  trip-fetch bundles in the background; review generates. */
  function advancePlan() {
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
    error,
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
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)] ${!preResult ? "dashboard-page" : generating || refining ? "" : "map-chrome-hidden"}`}
    >
      {/* No SceneBackdrop here any more: the planner page draws its own stage (the place's photograph,
          or the night over Wadi Rum) behind every step. */}

      {/* Gated here rather than left to the component's own `if (!active) return null`. It is
          behind a dynamic() boundary now, and an unconditionally-rendered dynamic component
          fetches its chunk on first render — i.e. on the landing, which is the one thing the
          boundary exists to prevent. */}
      {/* A generate is written on the live map under the Polar screen (the canvas design "Live map,
          writing the plan · C Monument"); a refine, from the result view, keeps the foot band. */}
      {generating && !refining && (
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
      {refining && (
        <GenerationScreen
          mode="refine"
          stages={stages}
          facts={destinationFacts}
          destination={destination}
          dateRange={startDate && endDate ? formatDateRange(startDate, endDate) : null}
          tripDays={days}
          tierName={TIERS.find((t) => t.id === tier)?.name ?? null}
          budget={budget}
          rawFetch={rawFetch}
          onCancel={cancelGeneration}
          // A `sketch` frame fills the draft with day themes and no stops, so it does not count.
          streaming={draftItinerary?.days.some((d) => d.stops.length > 0) ?? false}
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
          reaches the page. Gone while a plan is written: the live map, the streaming plan panel and
          GenerationScreen's band take the screen, as they always have. */}
      {step === "plan" && !generating && (
        <div className="-mx-5 -mb-5 -mt-[calc(var(--nav-h)+1.25rem)] sm:-mx-6 sm:-mb-6 sm:-mt-[calc(var(--nav-h)+1.5rem)]">
          <PlanningFlow model={plannerModel} />
        </div>
      )}

      {/* Also mounted while a generation streams, which is what makes the wait watchable: the
          panel opens collapsed to its capsule, and the card inside it — kept mounted rather than
          unmounted, see DockedPanel — runs its `showTripRoute` effect on every arriving stop, so
          the route and the marker cards build themselves on the live map behind the foot band.
          The card is the same one the result view uses; only the value differs. */}
      {(step === "result" || generating || refining) && shownItinerary && (
        <DockedPanel
          collapsible
          busy={refining}
          // The panel stays through the film, shut to its capsule — see the same note in TripView.
          capsuleAction={
            // Not offered mid-run: the film narrates a finished day, and a day that is still
            // arriving has neither a script to write from nor a camera to spare — the route
            // replay owns it until the last stop lands.
            // And gone once one starts: the button leaves for `StoryStage`'s transport row rather
            // than being mirrored in two places — see the note there.
            step === "result" && !streamingPlan && itinerary?.days.length && !story.active
              ? {
                  label: `Play day ${activeDayIndex + 1} as a story`,
                  onClick: () =>
                    itinerary &&
                    story.start({
                      itinerary,
                      dayIndex: activeDayIndex,
                      destination,
                      // No trip id: the pre-save view's `trip` prop is the `"preview"`
                      // placeholder, so its scripts are cached in the browser for the session
                      // and not against a row.
                    }),
                  icon: <PlayIcon className="h-4 w-4" />,
                }
              : undefined
          }
          wide={!!focus.target}
          collapsed={planCollapsed}
          // Opening the plan mid-film ends the film — see the same handler in TripView.
          onCollapsedChange={(next) => {
            if (!next && story.active) story.exit();
            setPlanCollapsed(next);
          }}
          // What the capsule carries while the panel is shut — the trip at a glance, so
          // "which day was I reading" survives a look at the map. Pre-save there is no trip
          // row yet, so this reads the form's own destination, the way the arrange board does.
          capsule={
            destination
              ? {
                  title: destination,
                  ...capsuleDays({ days: shownItinerary?.days, streaming: streamingPlan, tripDays: days, activeDayIndex }),
                }
              : undefined
          }
        >
          <div className="space-y-6" {...devLabel("ResultPanel")}>
            {/* refine()/save() can fail after the card is already showing — this is the
                only place either error would otherwise have nowhere to render. */}
            {error && <ErrorNote>{error}</ErrorNote>}

            {/* Kept mounted (not unmounted) behind the stop-detail panel below, so the active
                day and this panel's scroll position both survive the round trip instead of
                resetting when ItineraryCard remounts. */}
            <div className={selectedStop ? "hidden" : "space-y-6"}>
              {/* Withheld while a run streams. `backToLanding` does not abort the request, so
                  from here it would leave a five-minute model call running invisibly — Cancel in
                  the generation band is the one way out of a run, and it is right there. */}
              {step === "result" && !streamingPlan && (
                <div className="flex items-center gap-3">
                  <button type="button" onClick={backToLanding} className={backPillClass}>
                    <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
                    Back
                  </button>
                </div>
              )}
              {/* Focus Mode takes over the card while editing a day. */}
              {focus.target && focus.draft && (
                <FocusEditMode
                  trip={{ id: "", destination, startDate, endDate, budget }}
                  userAnswers={currentAnswers()}
                  draft={focus.draft}
                  dayIndex={focus.target.dayIndex}
                  scope={focus.target.scope}
                  sessionId={lastSessionId}
                  initialMessage={focus.target.initialMessage}
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
                    if (committed) {
                      // A local edit outranks a critique revision that lands after it — see
                      // editedSincePlanRef.
                      editedSincePlanRef.current = true;
                      setItinerary(committed);
                    }
                  }}
                />
              )}

              {!focus.target && hasProfile === false && !onboardingDismissed && (
                <OnboardingCard
                  answers={{
                    group,
                    pace,
                    discovery,
                    explorerStyle,
                    energy,
                    crowds,
                    priorities: interests,
                    topPriorities: starredInterests,
                    // The wizard already asked; carry it so the saved profile starts out
                    // matching what they just said rather than blank.
                    accessibility: accessibility ?? NO_ACCESSIBILITY_NEEDS,
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
                  itinerary={shownItinerary}
                  budget={budget}
                  destination={destination}
                  onSelectStop={(stop) => {
                    setRevealAnimation(false);
                    selectStop(stop);
                  }}
                  // Read-only while the plan is still being written: a drag or an inline day edit
                  // lands in `itinerary`, and the very next streamed stop would overwrite it.
                  editable={!streamingPlan}
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
                  onFitAnchor={(name) => focus.open(activeDayIndex, "trip", fitMessage(name))}
                />
              )}

              {/* The one thing that reports the background critique once the band is gone.
                  Spec §5 keeps the progress strip on the list of what must survive, and Risk 3
                  asks for the review to be "visibly in progress so a change is expected rather
                  than startling" — but the literal answer, keeping the band up, means a status
                  bar over a finished editable plan for another two minutes. A phrase in the
                  footer sets the expectation at the cost of one line; the arriving change itself
                  is announced by the day dots `markUnseenDays` sets from the `revised` hook.
                  `!generating` rather than plain `reviewing`: the two overlap for ARRIVAL_HOLD_MS
                  while the band is still up, and both saying it at once is noise. */}
              {step === "result" && !focus.target && itinerary && reviewing && !generating && (
                <p role="status" aria-live="polite" className="px-1 text-xs text-muted">
                  Still reviewing this plan. A day or two may change in a minute.
                </p>
              )}
              {/* `step === "result"`, because `itinerary` is not cleared when a traveller presses
                  Back and plans a second trip: on trip B's generation this row would otherwise
                  offer trip A's Keep and Refine under trip B's streaming card — and unlike a
                  refine, a generate leaves the panel interactive (`busy={refining}` is false), so
                  both would work. `save()` would promote trip A's draft row and `router.push`
                  away without aborting the run, and `onRefine` would fire a second model call
                  against trip A mid-generate. `itinerary` rather than `shownItinerary` on top of
                  that, because Keep and Refine act on a finished plan and a half-written draft is
                  not one.

                  **Deliberately NOT `!streamingPlan`, unlike its two neighbours above.** That
                  term does real work on the card render and the Play button, which both act on
                  the draft. Here it could only ever fire during a refine — where `step` is already
                  `"result"` and `itinerary` is the *current* trip, so there is no stale-trip
                  hazard left to guard — and it would unmount this row for the whole rework,
                  losing its in-place busy state for no safety at all. Don't "fix" the
                  inconsistency with its neighbours; the inconsistency is the point. */}
              {step === "result" && !focus.target && itinerary && (
                <FeedbackLoop
                  onSave={save}
                  onRefine={refine}
                  saving={saving}
                  refining={refining}
                  draftState={draftState}
                />
              )}
            </div>

            {selectedStop && (
              <PlaceDetailPanel
                stop={selectedStop}
                detail={detail}
                loading={detailLoading}
                error={detailError}
                onBack={closeDetail}
                upcomingStops={upcomingStopsAfter(shownItinerary, selectedStop)}
                onSelectUpcoming={selectStop}
              />
            )}
          </div>
        </DockedPanel>
      )}
    </main>
  );
}
