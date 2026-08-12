"use client";

import { ComponentType, ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarCheck, CalendarDays, MapPin, Wallet } from "lucide-react";
import ItineraryCard from "@/components/ItineraryCard";
import FeedbackLoop from "@/components/FeedbackLoop";
import TierPicker from "@/components/TierPicker";
import PlaceDetailPanel from "@/components/PlaceDetailPanel";
import ScrollStory from "@/components/blue-hour/ScrollStory";
import GenerationLoader from "@/components/cesium/GenerationLoader";
import ErrorNote from "@/components/ErrorNote";
import DockedPanel from "@/components/DockedPanel";
import { closestTier, isTripTooLong, MAX_TRIP_DAYS, tripDays, TierId } from "@/lib/tiers";
import { Itinerary } from "@/lib/types";
import { GeocodeOutcome, useTripCamera } from "@/lib/useTripCamera";
import { useMapCamera } from "@/lib/mapCamera";
import { upcomingStopsAfter } from "@/lib/itinerary";

type Step = "landing" | "plan" | "result";

/** The server's own message when it wrote one for a person, this operation's own
 *  sentence otherwise — a network throw has a message like "Failed to fetch". */
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// Local calendar date in ISO shape. `toISOString()` would be UTC and roll the date over a
// day early for anyone west of Greenwich in the evening; "sv-SE" formats local time as
// YYYY-MM-DD, which is exactly what <input type="date"> wants.
const todayISO = () => new Date().toLocaleDateString("sv-SE");

const ghostButtonClass =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-foreground/70 transition-colors hover:bg-tag-neutral-bg focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none";
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
  /** Destination takes more of the row than the three fixed-width figures beside it. */
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

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("landing");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState(1000);
  const [tier, setTier] = useState<TierId>("midrange");
  const [geocode, setGeocode] = useState<GeocodeOutcome>("found");

  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    flyToDestinationByName,
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
  // five-year range and then the form refused it. `tripDays` counts inclusively, so
  // the last allowed end date is start + 29.
  const maxEndDate = startDate
    ? new Date(new Date(startDate).getTime() + (MAX_TRIP_DAYS - 1) * 86400000)
        .toISOString()
        .slice(0, 10)
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
    setGeocode(await flyToDestinationByName(name));
  }

  function backToLanding() {
    setStep("landing");
    setError(null);
    // Required, not cosmetic: a blur-triggered flight left the spin locked and a pin dropped.
    // resetToHome is the only thing that clears the pin and calls startAutoRotate() again.
    resetToHome();
  }

  /** Cross-field rules the browser's own constraint validation can't express. */
  function validate(): string | null {
    if (endDate < startDate) return "End date must be on or after the start date.";
    if (isTripTooLong(startDate, endDate)) {
      return `Trips longer than ${MAX_TRIP_DAYS} days aren't supported. Choose a shorter date range.`;
    }
    return null;
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
        body: JSON.stringify({ destination, startDate, endDate, budget, tier }),
      });
      const data = await res.json();
      // Each of the three operations names itself in its fallback: "Something went
      // wrong" was the message for generate, refine and save alike, which told you
      // neither what failed nor what to do next.
      if (!res.ok) throw new Error(data.error);
      setItinerary(data.itinerary);
      setStep("result");
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItinerary(data.itinerary);
    } catch (e) {
      setError(errorMessage(e, "We couldn't apply that change. Your current plan is unchanged."));
    } finally {
      setRefining(false);
    }
  }

  async function save() {
    if (!itinerary) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, startDate, endDate, budget, itinerary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/trip/${data.id}`);
    } catch (e) {
      setError(errorMessage(e, "We couldn't save this trip. Try again."));
      setSaving(false);
    }
  }

  return (
    // pt-[calc(var(--nav-h)+1.25rem)]: clearance for the fixed glass navbar (AppShell
    // renders it above this content). Only the top padding changes — ScrollStory's own
    // cancelling wrapper mirrors this exact value so its full-bleed sections still
    // reach the very top, behind the (transparent) nav, unaffected by this gap.
    <main
      className={`flex min-h-full flex-col gap-6 bg-transparent p-5 pt-[calc(var(--nav-h)+1.25rem)] sm:p-6 sm:pt-[calc(var(--nav-h)+1.5rem)] ${!preResult ? "dashboard-page" : "map-chrome-hidden blue-hour-scene font-scene-body"}`}
    >
      {/* Refining is the same 30–60s wait as generating and used to show only a changed
          word on a button, with the stale itinerary still fully interactive underneath. */}
      <GenerationLoader active={generating || refining} mode={refining ? "refine" : "generate"} />

      {/* The plan step's own "My memories" link used to render here — moved into the
          global nav (Navbar.tsx), which now carries it on every step of this route. */}

      {/* The scroll story owns its own full-bleed beats (each min-h-[140dvh]) rather than
          living inside <main>'s flex-1 centering column — it needs real scroll height, not
          a single centered viewport. */}
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
                generate();
              }}
              className={`hero-rise ${cardClass}`}
            >
              {/* The step had no heading of any kind — it opened straight onto four
                  fields, so neither the page nor a screen reader named what you were
                  doing. Same display step as "Choose your style" below it. */}
              <h1 className="mb-4 font-scene-display text-xl font-semibold text-foreground">
                Plan your trip
              </h1>

              {/* One instrument, not four widgets. The trough is `--surface-deep` at a lower
                  alpha than the panel around it, so it reads as recessed into the glass rather
                  than stacked on top of it, and the cells are separated by the divider between
                  them. Stacks vertically below `md`, where four cells in a row would each be
                  narrower than the date they have to hold. */}
              <div className="field-console flex flex-col divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-surface-deep/50 md:flex-row md:divide-x md:divide-y-0">
                <Field icon={MapPin} label="Destination" delay={80} grow="md:flex-[1.5] flex-1">
                  <input
                    required
                    value={destination}
                    onChange={(e) => {
                      setDestination(e.target.value);
                      setGeocode("found");
                    }}
                    onBlur={flyToTypedDestination}
                    placeholder="Kyoto, Japan"
                    className={`${fieldInputClass} ${fieldFilledTone}`}
                  />
                </Field>
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
                    {/* aria-hidden, or the field's accessible name comes out as
                        "Total budget$" — the glyph is inside the label element. */}
                    <span aria-hidden="true" className="text-base font-medium text-muted">
                      $
                    </span>
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
                {geocode !== "found" && (
                  <p className="value-in mt-2.5 text-xs text-muted">
                    {geocode === "missed"
                      ? "Couldn't find that on the map. We'll still plan it."
                      : "Couldn't reach the map service. We'll still plan it."}
                  </p>
                )}
              </div>

              <div className="value-in mt-6" style={{ animationDelay: "320ms" }}>
                <h2 id="style-heading" className="font-scene-display text-xl font-semibold text-foreground">
                  Choose your style
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {days === null
                    ? "These are per-day rates. Add your dates and they become trip totals."
                    : `Rough estimates for ${days} ${days === 1 ? "day" : "days"}${
                        destination ? ` in ${destination}` : ""
                      }. Pick the one closest to the trip you want.`}
                </p>
                <div className="mt-4">
                  <TierPicker days={days} budget={budget} selected={tier} onSelect={pickTier} />
                </div>
              </div>

              <div
                className="value-in mt-6 flex items-center justify-between border-t border-card-border pt-5"
                style={{ animationDelay: "440ms" }}
              >
                <button type="button" onClick={backToLanding} className={ghostButtonClass}>
                  Back
                </button>
                <button
                  type="submit"
                  className="group inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground shadow-sm transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none active:scale-[0.98]"
                >
                  Generate itinerary
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
                    strokeWidth={2.25}
                  />
                </button>
              </div>
            </form>

            {/* role="alert" — this one *is* an interruption: the user pressed Generate and
                nothing happened, and focus stays on the button they just pressed. */}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </div>
      )}

      {step === "result" && itinerary && (
        // Docked panel floating over the full-screen globe rather than a normal-flow
        // block — `fixed` escapes AppShell's own scrollable content pane entirely, so
        // this positions relative to the viewport and scrolls independently.
        <DockedPanel collapsible busy={refining}>
          {/* Hidden, not unmounted. ItineraryCard owns the active day index, the panel
              owns its scroll position, and the tour owns its interval — unmounting the
              card to show a place detail threw all three away, so coming back from a
              stop on day 5 landed you on day 1 at the top of the panel. */}
          <div className={selectedStop ? "hidden" : "space-y-6"}>
            <ItineraryCard
              itinerary={itinerary}
              budget={budget}
              destination={destination}
              onSelectStop={selectStop}
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <FeedbackLoop onSave={save} onRefine={refine} saving={saving} refining={refining} />
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
        </DockedPanel>
      )}
    </main>
  );
}
