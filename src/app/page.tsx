"use client";

import { ComponentType, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarCheck, CalendarDays, MapPin, Wallet } from "lucide-react";
import ItineraryCard from "@/components/ItineraryCard";
import { DayEditUpdates } from "@/components/DayHeader";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import InterestPicker from "@/components/InterestPicker";
import ExplorerStylePicker from "@/components/ExplorerStylePicker";
import GroupTypePicker from "@/components/GroupTypePicker";
import ChoicePicker, { CROWD_PREFERENCES, ENERGY_LEVELS } from "@/components/ChoicePicker";
import PoiCandidatePicker from "@/components/PoiCandidatePicker";
import FocusEditMode from "@/components/FocusEditMode";
import { useFocusEdit } from "@/lib/useFocusEdit";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import GenerationLoader from "@/components/cesium/GenerationLoader";
import DestinationSearch from "@/components/DestinationSearch";
import ScrollStory from "@/components/blue-hour/ScrollStory";
import DockedPanel from "@/components/DockedPanel";
import ErrorNote from "@/components/ErrorNote";
import { backPillClass } from "@/components/BrandMark";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { CrowdPreference, EnergyLevel, ExplorerStyle, GroupType, Itinerary, RawFetch } from "@/lib/types";
import { CandidatePoi } from "@/lib/pois";
import { useTripCamera } from "@/lib/useTripCamera";
import { useMapCamera } from "@/lib/mapCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";
import { devLabel } from "@/lib/devInspector";
import type { TravelerProfile } from "@/lib/travelerProfile";

/** Fallback shown only when the thrown error carries no message of its own. */
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

type Step = "landing" | "plan" | "result";
/** Screens 2-6 need nothing from the backend, which is what gives the Step 2a fetch time to
 *  land before `pois` — the one fetch-dependent screen — is ever reached. Keep `pois` last. */
type PlanStep = "basics" | "purpose" | "group" | "profile" | "crowds" | "priorities" | "pois";
const PLAN_ORDER: PlanStep[] = ["basics", "purpose", "group", "profile", "crowds", "priorities", "pois"];

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
  children,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  delay: number;
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

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("landing");
  const [planStep, setPlanStep] = useState<PlanStep>("basics");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);
  const [tier, setTier] = useState<TierId>("midrange");
  const [interests, setInterests] = useState<string[]>([]);
  const [starredInterests, setStarredInterests] = useState<string[]>([]);
  const [destinationMissed, setDestinationMissed] = useState(false);

  // Step 2b — collected alongside the existing basics/interests/style answers, sent to
  // Step 3 as `userAnswers` once generation runs (see `generate()` below).
  const [purpose, setPurpose] = useState("");
  const [explorerStyle, setExplorerStyle] = useState<ExplorerStyle>("mixed");
  const [group, setGroup] = useState<GroupType>("solo");
  const [energy, setEnergy] = useState<EnergyLevel>("moderate");
  const [crowds, setCrowds] = useState<CrowdPreference>("mixed");
  const [selectedPois, setSelectedPois] = useState<CandidatePoi[]>([]);
  const [customPois, setCustomPois] = useState<string[]>([]);

  // The profile supplies defaults; the wizard always wins. Nothing here is locked —
  // a solo traveler who usually goes with kids just changes it on the screen, and
  // that trip's answers are what generation sees. Any failure leaves the hardcoded
  // defaults above in place, which is the same experience as a first visit.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const profile: TravelerProfile | null = data?.profile ?? null;
        if (cancelled || !profile) return;
        setGroup(profile.group);
        setExplorerStyle(profile.explorerStyle);
        setEnergy(profile.energy);
        setCrowds(profile.crowds);
        // pickTier, not setTier: marks tierTouched so the live budget/days auto-recommend
        // below never overwrites a saved preference — but that also means it's permanent
        // for the rest of this session, even if the traveler then enters a wildly
        // different budget. Deliberate (a saved tier is a stated one), not a bug to
        // "simplify" back to setTier.
        pickTier(profile.tier);
        setInterests(profile.priorities);
        setStarredInterests(profile.topPriorities);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2a — fired fire-and-forget right alongside the existing destination-context
  // warmer, the moment basics are submitted. Never blocks the wizard from advancing;
  // `rawFetchLoading` only gates the POI picker's own loading state.
  const [rawFetch, setRawFetch] = useState<RawFetch | null>(null);
  const [rawFetchLoading, setRawFetchLoading] = useState(false);

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  // Id of the LLM pipeline run that produced the current `itinerary` — tracks
  // the most recent generate/refine call so save() can attach it to the
  // trip, letting later place-detail calls append to that same run.
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  // Plays the staggered card reveal + typewriter effect once, right after a fresh
  // generation — cleared the moment a stop is opened so backing out of the detail view
  // doesn't replay the whole entrance again.
  const [revealAnimation, setRevealAnimation] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  // Owned here, not inside ItineraryCard: opening a stop's detail unmounts the card, so local
  // state there would reset the view to Day 1 on the way back.
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  // Step 7 edit session. `chatScope` null = closed; { dayIndex: null } = whole trip.
  const focus = useFocusEdit(itinerary);
  const [error, setError] = useState<string | null>(null);

  const {
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

  // Drives this page's own cosmetics (dark dashboard header/nav once results exist,
  // destination-form positioning) — AppShell's layout itself no longer varies by route/step.
  // Also gates the map control stack via .map-chrome-hidden: hidden on landing (that step is
  // a poster, not a map to read) and on plan (the panel reaches the bottom-left corner below
  // ~1292px), shown on result. Do not "simplify" this to step === "landing".
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

  // Auto-pick tracks budget and dates live, right up until the user picks a card themselves —
  // that live coupling is the whole point of merging the form and the tier step. A ref, not
  // state, because flipping the flag must not re-run the effect that reads it.
  const tierTouched = useRef(false);
  useEffect(() => {
    if (tierTouched.current || days === null) return;
    setTier(closestTier(budget, days));
  }, [budget, days]);

  function pickTier(next: TierId) {
    tierTouched.current = true;
    setTier(next);
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

  // One geocode per completed edit of the destination field, fired on blur. Not on a
  // keystroke debounce: mapCamera's flyTo calls stopAutoRotate(), which is a permanent lock
  // only resetToHome() ever clears, so the first keystroke-triggered flight would kill the
  // idle spin for the session — and the overlapping 2.5s flights visibly lurch the camera
  // through everywhere the prefix matched on the way to the real destination.
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
    // Required, not cosmetic: a blur-triggered flight left the spin locked and a pin dropped.
    // resetToHome is the only thing that clears the pin and calls startAutoRotate() again.
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
      energy,
      crowds,
      budget,
      priorities: interests,
      topPriorities: starredInterests,
      selectedPois,
      customPois,
    };
  }

  async function generate() {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          startDate,
          endDate,
          budget,
          tier,
          preferences: { tags: interests, vibe: null },
          // Step 2b's output — /api/itinerary doesn't read this yet (that's Step 3's job),
          // but this is the existing mechanism by which 2b hands answers to generation.
          userAnswers: currentAnswers(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate itinerary");
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
      setRevealAnimation(true);
      setStep("result");

      // After success only, never on each screen advance: a wizard the traveler
      // abandoned halfway is not a statement about how they travel. Failures are
      // swallowed — this must never surface an error on a trip they just waited
      // two minutes for.
      fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            group,
            explorerStyle,
            energy,
            crowds,
            tier,
            priorities: interests,
            topPriorities: starredInterests,
          },
        }),
      }).catch(() => {});
    } catch (e) {
      setError(errorMessage(e, "We couldn't build your itinerary. Try generating again."));
    } finally {
      setGenerating(false);
    }
  }

  async function refine(feedback: string) {
    setRefining(true);
    setError(null);
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          startDate,
          endDate,
          budget,
          previousItinerary: itinerary,
          feedback,
          userAnswers: currentAnswers(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to refine itinerary");
      setItinerary(data.itinerary);
      setLastRunId(data.runId ?? null);
    } catch (e) {
      setError(errorMessage(e, "We couldn't apply that change. Your current plan is unchanged."));
    } finally {
      setRefining(false);
    }
  }

  // Pre-save editing is local-state only — there's no trip row to persist to
  // until save() runs, so these just mutate the in-progress itinerary.
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
        step === "landing" ? "blue-hour-scene font-scene-body" : ""
      }`}
    >
      <GenerationLoader active={generating || refining} mode={refining ? "refine" : "generate"} />

      {/* The Blue Hour scroll story: a photo hero with no CTA, an image row and a mechanism
          explainer, and "Plan a trip" uncovered only at the end. It owns full-bleed sections
          with real scroll height, so it replaces the single centered hero this step used to
          be — but it hands off to the same setStep("plan"), which is this app's own multi-step
          form rather than the standalone build's one-card console. */}
      {step === "landing" && <ScrollStory onPlan={() => setStep("plan")} />}

      {/* Form and tier picker merged into one card: the dates and budget are what price the
          tiers, so splitting them across two steps meant choosing a style blind. One <form>
          around both halves so the browser's own constraint validation gates the submit
          button that now sits below the tier cards. */}
      {step === "plan" && !generating && (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-5xl space-y-4">
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
                  }).catch(() => {});
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
                      </Field>
                    </div>
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
                    className="w-full rounded-full bg-white/10 px-3.5 py-2 text-sm text-foreground placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                  />
                </Screen>
              )}

              {planStep === "group" && (
                <Screen
                  name="Group"
                  title="Who's going, and how do you explore?"
                  subtitle="This sets the ceiling on how much we fit into a day."
                >
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Who&apos;s going</label>
                      <GroupTypePicker selected={group} onSelect={setGroup} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Explorer style</label>
                      <ExplorerStylePicker selected={explorerStyle} onSelect={setExplorerStyle} />
                    </div>
                  </div>
                </Screen>
              )}

              {planStep === "profile" && (
                <Screen
                  name="Profile"
                  title="How much walking suits you?"
                  subtitle="We pick the stops from this — how you travel matters more than a list of landmarks."
                >
                  <ChoicePicker name="energy" options={[...ENERGY_LEVELS]} selected={energy} onSelect={setEnergy} />
                </Screen>
              )}

              {planStep === "crowds" && (
                <Screen
                  name="Crowds"
                  title="Crowds, and what you'll spend"
                  subtitle={
                    days === null
                      ? "Add your dates and the per-day rates below become trip totals."
                      : `Rough estimates for ${days} ${days === 1 ? "day" : "days"}${
                          destination ? ` in ${destination}` : ""
                        }.`
                  }
                >
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Crowds</label>
                      <ChoicePicker
                        name="crowds"
                        options={[...CROWD_PREFERENCES]}
                        selected={crowds}
                        onSelect={setCrowds}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted">Style and budget</label>
                      <TierPicker days={days} budget={budget} selected={tier} onSelect={pickTier} />
                    </div>
                  </div>
                </Screen>
              )}

              {planStep === "priorities" && (
                <Screen
                  name="Priorities"
                  title="What matters most?"
                  subtitle="Pick what interests you, then star up to three — the starred ones drive the plan."
                >
                  <InterestPicker
                    selected={interests}
                    starred={starredInterests}
                    onToggle={toggleInterest}
                    onToggleStar={toggleInterestStar}
                  />
                </Screen>
              )}

              {/* Last on purpose: the only screen that needs Step 2a's fetch, by which point the
                  five preceding screens have given it time to land. Leaving it empty is normal —
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
        <DockedPanel collapsible busy={refining} wide={!!focus.target}>
          <div className="space-y-6" {...devLabel("ResultPanel")}>
            {/* refine()/save() can fail after the card is already showing — this is the
                only place either error would otherwise have nowhere to render. */}
            {error && <ErrorNote>{error}</ErrorNote>}

            {/* Kept mounted (not unmounted) behind the stop-detail panel below, so the
                active day, this panel's scroll position and the stop tour's interval all
                survive the round trip instead of resetting when ItineraryCard remounts. */}
            <div className={selectedStop ? "hidden" : "space-y-6"}>
              <button type="button" onClick={backToLanding} className={backPillClass}>
                <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
                Back
              </button>
              {/* Focus Mode takes over the card while editing a day. */}
              {focus.target && focus.draft && (
                <FocusEditMode
                  trip={{ id: "", destination, startDate, endDate, budget }}
                  userAnswers={currentAnswers()}
                  draft={focus.draft}
                  dayIndex={focus.target.dayIndex}
                  scope={focus.target.scope}
                  dirty={focus.dirty}
                  onDraftChange={focus.applyDraft}
                  onCancel={focus.cancel}
                  onSave={() => {
                    const committed = focus.save();
                    if (committed) setItinerary(committed);
                  }}
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
                  onActiveDayChange={setActiveDayIndex}
                  onEditDay={handleEditDay}
                  onChatDay={(dayIndex) => focus.open(dayIndex, "day")}
                  animateReveal={revealAnimation}
                />
              )}

              {/* Mode B's shown delta — the updated itinerary is already persisted into state
                  above; this is only the human-readable part of that change. */}
              {!focus.target && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => focus.open(0, "trip")}
                    className={ghostButtonClass}
                  >
                    Refine with AI
                  </button>
                </div>
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
