"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Sparkles } from "lucide-react";
import { DayPlan, Itinerary, Stop, TripSummary } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import { useMapCamera } from "@/lib/mapCamera";
import { useStopTour } from "@/lib/useStopTour";
import { daySpendByCategory } from "@/lib/itinerary";
import { evaluateItinerary, Guardrail } from "@/lib/guardrails";
import SplitEditor from "./SplitEditor";
import { formatMoney } from "@/lib/format";
import BudgetBar from "./BudgetBar";
import DayHeader, { DayEditUpdates } from "./DayHeader";
import StopList from "./StopList";
import Typewriter from "./Typewriter";
import { devLabel } from "@/lib/devInspector";

/** Ms between each stop's reveal during the post-generation stagger. */
const REVEAL_STEP_MS = 400;
/**
 * The header photo's frame, in rem, mirrored from `.itinerary-hero` in globals.css.
 *
 * Duplicated deliberately, and only these two numbers: the collapse has to be measured in the same
 * units the scroller reports, and a custom property reads back unresolved (`"18rem"`, not `"288px"`)
 * unless it is registered with `@property`. Parsing them out of the computed style is the same
 * duplication with an extra step and a silent failure mode if the unit ever changes.
 */
const HERO_MAX_REM = { base: 14, sm: 18 };
const HERO_MIN_REM = 4.5;
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EntryIcon,
  FoodIcon,
  LodgingIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  TransitIcon,
} from "./icons";

function cityName(destination: string): string {
  return destination.split(",")[0].trim();
}

function BlurredPhotoLayer({ photo, tint }: { photo: string; tint: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 scale-110 bg-cover bg-center blur-lg"
        style={{ backgroundImage: `url(${photo})` }}
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: tint }} />
    </>
  );
}

/** Tiles for the day's spend. A category with nothing in it gets no tile: a day of
 *  sightseeing used to print `Food $0 · Entry $0 · Transit $0 · Stay $0` beside a
 *  Total that nothing on screen accounted for, because `other` was summed into the
 *  total and never given a tile of its own. Total is returned separately — it is
 *  the sum of the others, not a peer of them. */
function dayBreakdown(day: DayPlan) {
  const spend = daySpendByCategory(day);
  const tiles = [
    { label: "Food", amount: spend.food, Icon: FoodIcon },
    { label: "Entry", amount: spend.entry, Icon: EntryIcon },
    { label: "Transit", amount: spend.transit, Icon: TransitIcon },
    { label: "Other", amount: spend.other, Icon: PinIcon },
    { label: "Stay", amount: spend.stay, Icon: LodgingIcon },
  ].filter((tile) => tile.amount > 0);
  return { tiles, total: spend.total };
}

export default function ItineraryCard({
  itinerary,
  budget,
  destination,
  onSelectStop,
  editable,
  onLodgingActualCostChange,
  onEditDay,
  onChatDay,
  onItineraryChange,
  trip,
  activeDayIndex: controlledDayIndex,
  onActiveDayChange,
  animateReveal,
  panelCollapsed = false,
  onMinimize,
}: {
  itinerary: Itinerary;
  budget: number;
  destination: string;
  onSelectStop: (stop: Stop) => void;
  editable?: boolean;
  onLodgingActualCostChange?: (dayIndex: number, value: number | undefined) => void;
  onEditDay?: (dayIndex: number, updates: DayEditUpdates) => void;
  /** Mode A — open the chat scoped to this day. */
  onChatDay?: (dayIndex: number) => void;
  /** Enables hand-rearranging on the full-page board (opened from a day's pencil, or the
   *  "Arrange days" button). Re-timing happens locally in `moveStop`, so a drop resolves in the
   *  same frame — no model call. The host gets a complete itinerary back to persist. */
  onItineraryChange?: (next: Itinerary) => void;
  /** Needed by the arrange board for the trip's name and budget. Optional so read-only callers
   *  (which pass no `onItineraryChange` either) needn't supply it. */
  trip?: TripSummary;
  /** Optional controlled day selection. The host owns it when this page unmounts the card to
   *  show something else (a stop's detail panel) — otherwise the day would reset to 1 on the
   *  way back, since remounting reinitialises local state. Uncontrolled when omitted. */
  activeDayIndex?: number;
  onActiveDayChange?: (dayIndex: number) => void;
  /** Plays the staggered "AI is building this" reveal once, right after a fresh generation:
   *  day 1's header appears first, then each stop card + its map pin light up together every
   *  REVEAL_STEP_MS. Only ever applies to the initial day (index 0) shown on mount — switching
   *  day tabs (even mid-stagger) always shows the target day in full immediately. */
  animateReveal?: boolean;
  /**
   * Draw the whole trip on the globe without framing any one day — set while the plan panel is
   * collapsed and the map *is* the view.
   *
   * The card takes this rather than reading the panel itself because it is the only thing that
   * knows the itinerary, and therefore the only thing that can hand the globe every day at once.
   * Flipping it re-runs the route effect, which is what makes closing the panel pull back to the
   * whole trip and opening it drop onto the active day again.
   *
   * It is handed to `showTripRoute` twice, for two different questions: as the focus (collapsed
   * means no day is singled out) and as `panelVisible` (whether there is a panel to aim beside).
   */
  panelCollapsed?: boolean;
  /** Shuts the panel to its capsule. Given, the header image grows a grab line along its top
   *  edge — the handle belongs on the picture rather than on a bar of chrome above it. */
  onMinimize?: () => void;
}) {
  const [uncontrolledDayIndex, setUncontrolledDayIndex] = useState(0);
  const activeDayIndex = controlledDayIndex ?? uncontrolledDayIndex;
  const setActiveDayIndex = (next: number | ((i: number) => number)) => {
    const value = typeof next === "function" ? next(activeDayIndex) : next;
    if (onActiveDayChange) onActiveDayChange(value);
    else setUncontrolledDayIndex(value);
  };
  const headerPhoto = usePlacePhoto(destination, "full");
  const dayIndex = Math.min(activeDayIndex, itinerary.days.length - 1);
  const day = itinerary.days[dayIndex];
  const { showTripRoute, hoveredIndex, setHoveredIndex, activeIndex } = useMapCamera();

  /** Every day's stops in the shape the globe wants, carrying the day index the colour ramp and
   *  the cluster labels are keyed on. Memoised because it is a dependency of the route effect —
   *  rebuilding the array each render would redraw the whole trip on every keystroke. */
  const routeDays = useMemo(
    () =>
      itinerary.days.map((d, i) =>
        d.stops.map((st) => ({ lat: st.lat, lng: st.lng, name: st.name, day: i }))
      ),
    [itinerary.days]
  );
  /** Where this day's stops start in the flat list the map indexes hover/selection by. The panel
   *  numbers its rows from 0 within the day, so every index crossing this boundary is shifted. */
  const dayOffset = useMemo(
    () => routeDays.slice(0, dayIndex).reduce((n, d) => n + d.length, 0),
    [routeDays, dayIndex]
  );
  /** The map's flat highlight index expressed as a row of *this* day, or null when what is
   *  highlighted belongs to another day — which is now possible, since every day is on screen. */
  const highlightedRow = (() => {
    const flat = hoveredIndex ?? activeIndex;
    if (flat === null) return null;
    const row = flat - dayOffset;
    return row >= 0 && row < (routeDays[dayIndex]?.length ?? 0) ? row : null;
  })();
  /** Read by the one-shot stagger interval, which must not re-run when the panel opens — the
   *  stagger is mounted once and a dep on `panelCollapsed` would restart it on every collapse. */
  const panelCollapsedRef = useRef(panelCollapsed);
  const { playing: touring, toggle: toggleTour, stop: stopTour } = useStopTour();
  const heroRef = useRef<HTMLDivElement>(null);
  const dayTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dayTabStripRef = useRef<HTMLDivElement>(null);
  const [revealedCount, setRevealedCount] = useState(animateReveal ? 0 : Infinity);
  const activeDayRef = useRef(dayIndex);
  const staggerStartedRef = useRef(false);
  // The very first "day changed" effect pass fires on mount too — when animating, that pass
  // must defer to the stagger effect below instead of instantly revealing everything.
  const skipNextInstantRevealRef = useRef(!!animateReveal);

  /** The full-page arrange board, opened by a day's edit (pencil) control.
   *
   * Rearranging used to happen in this list, which meant a cross-day move had to be performed
   * against a day the traveller couldn't see: drag onto a day *tab*, hold until it opened, then
   * drop. The board shows every day at once instead, so both ends of a move are visible for the
   * whole gesture — and this list goes back to being purely for reading. */
  const [boardOpen, setBoardOpen] = useState(false);
  /** Whether this card is an editing surface at all (the host gave us a way to commit changes). */
  const canRearrange = !!onItineraryChange;

  /**
   * The itinerary as it first arrived — straight from generation, or straight from the database.
   *
   * Captured once, via `useState`'s initial value rather than a ref: it is what every later
   * version is compared against, so it must not follow the prop — and a ref cannot be read
   * during render, which is exactly where this comparison belongs. Identity is the whole test,
   * which works because every edit path
   * here builds a new object (`moveStop`, `updateStop`, the refine's `revisedDays`) rather than
   * mutating in place — the same property `onItineraryChange`'s callers already depend on.
   */
  const [asGenerated] = useState(itinerary);
  /** True once the plan on screen is no longer the one that was handed over. */
  const edited = itinerary !== asGenerated;

  /**
   * Guardrails, recomputed from the itinerary itself rather than remembered from the last drop —
   * so they describe the plan on screen whoever last changed it.
   *
   * **Held back until something is actually changed.** A freshly generated plan is the model's
   * own work, already run past the critique pass, and opening it under a row of warnings reads
   * as "we made you something broken" — the traveler has done nothing yet and has no way to act
   * on them. They are feedback on *your* edit: move a stop somewhere it cannot be reached in
   * time and the warning is the answer to what you just did. The findings themselves are
   * unchanged; only when they surface is.
   */
  const findings = useMemo(
    () => (canRearrange && edited ? evaluateItinerary(itinerary, { budget }) : []),
    [canRearrange, edited, itinerary, budget]
  );

  useEffect(() => {
    activeDayRef.current = dayIndex;
  }, [dayIndex]);

  /**
   * The collapsing header: the photo compresses as the plan scrolls under it and springs back on
   * the way up, staying pinned the whole time.
   *
   * Written as one CSS custom property per frame rather than React state, and that is the point —
   * a `useState` here would re-render this card, its day list and every consumer of the map camera
   * context on every scroll frame. `--hero-p` (0 unscrolled, 1 fully compressed) drives the
   * height and both titles' opacity from `.itinerary-hero` in globals.css, so the whole animation
   * is one property write against the compositor.
   *
   * The scroller is found rather than passed: this card sits inside `DockedPanel`'s body on the
   * result view and the trip page, but it is also rendered on the print page, where there is no
   * scroller at all and the header simply stays at full height. Walking up to the nearest
   * `overflow-y: auto` ancestor keeps the card from having to know which of those it is in.
   */
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || !headerPhoto) return;
    let scroller: HTMLElement | null = null;
    for (let el = hero.parentElement; el; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        scroller = el;
        break;
      }
    }
    if (!scroller) return;

    let frame = 0;
    /**
     * One pixel of scroll gives up one pixel of header, which is what keeps the two in step.
     *
     * A shorter range was tried and is wrong in a way that is invisible until you scroll: the
     * header is in flow, so shrinking it also lifts everything below it. Collapse faster than the
     * scroll and the plan rushes up to meet a header that is still eating itself.
     */
    const collapseRange = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const max = window.innerWidth >= 640 ? HERO_MAX_REM.sm : HERO_MAX_REM.base;
      return (max - HERO_MIN_REM) * rem;
    };
    let range = collapseRange();
    const apply = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, scroller.scrollTop / range));
      hero.style.setProperty("--hero-p", progress.toFixed(3));
    };
    const onResize = () => {
      range = collapseRange();
      apply();
    };
    const onScroll = () => {
      // Coalesced to one write per frame: a trackpad fires scroll events far faster than the
      // compositor paints, and each of these touches style on an element with a photo in it.
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    apply();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // `dayIndex` is in here because switching days scrolls the body back to the top in the effect
    // below; re-running re-reads that scrollTop rather than leaving a stale compressed header.
  }, [headerPhoto, dayIndex]);

  useEffect(() => {
    panelCollapsedRef.current = panelCollapsed;
  }, [panelCollapsed]);

  // Glowing pins + connecting arc for whichever day is active, redrawn on every day-tab
  // switch — including switching away from day 1 mid-stagger, which is how leaving the
  // animation early works: the new day just shows in full immediately.
  //
  // With the panel shut there is no active day to speak of: `null` is what puts the globe into
  // the whole-trip overview, every day drawn in its own colour with a label on each cluster.
  // Passing `dayIndex` unconditionally here is the same as never collapsing at all — the day
  // stays focused, the other days stay off the map, and the overview can never be reached.
  useEffect(() => {
    if (!day) return;
    if (skipNextInstantRevealRef.current) {
      skipNextInstantRevealRef.current = false;
      return;
    }
    setRevealedCount(day.stops.length);
    // `soloFocus` — picking a day in this panel means "show me this day", so the globe draws
    // that day alone. Collapsed, the focus is null and every day is up as the trip overview.
    // The split editor passes this false: editing needs the other days on screen.
    showTripRoute(routeDays, panelCollapsed ? null : dayIndex, !panelCollapsed, true);
  }, [day, dayIndex, routeDays, panelCollapsed, showTripRoute]);

  // Staggered reveal, played once on mount when animateReveal is true: every REVEAL_STEP_MS,
  // one more stop card mounts (with its own slide-down + typewriter, see StopRow) and its map
  // pin joins the route together.
  useEffect(() => {
    if (!animateReveal || staggerStartedRef.current) return;
    staggerStartedRef.current = true;
    const stops = itinerary.days[0]?.stops ?? [];
    let i = 0;
    const id = setInterval(() => {
      if (activeDayRef.current !== 0) {
        clearInterval(id);
        return;
      }
      i += 1;
      setRevealedCount(i);
      // Skipped while the plan panel is collapsed. The stagger is a *panel* animation — cards
      // sliding in one by one — and with the panel shut the only thing it would do is undraw
      // and redraw day 1 a stop at a time on a map that already shows it whole. The reveal
      // still advances, so opening the panel finds it played out.
      if (!panelCollapsedRef.current) {
        showTripRoute(
          routeDays.map((d, k) => (k === 0 ? d.slice(0, i) : d)),
          0
        );
      }
      if (i >= stops.length) clearInterval(id);
    }, REVEAL_STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately one-shot on mount
  }, [animateReveal]);

  // The host cancels animateReveal when a stop is opened (the card stays mounted behind the
  // detail panel rather than unmounting), which would otherwise leave the stagger frozen
  // wherever it had gotten to — the "day changed" effect above only catches a day *switch*,
  // not this same-day cancellation. Catch day 1 up to fully revealed instead.
  const wasAnimatingRef = useRef(!!animateReveal);
  useEffect(() => {
    if (wasAnimatingRef.current && !animateReveal && day) {
      setRevealedCount(day.stops.length);
    }
    wasAnimatingRef.current = !!animateReveal;
  }, [animateReveal, day]);

  // Keep the active day tab scrolled into view, including when the arrows below move it.
  //
  // The strip is scrolled directly rather than via `tab.scrollIntoView()`. That call walks
  // *every* scrollable ancestor, so even with `block: "nearest"` it scrolled the docked panel
  // itself — on mount it pushed the panel down ~100px and hid the surface's own top row.
  // Setting `scrollLeft` on the one element that should move touches nothing else, and
  // centring reads better than "nearest" on a many-day row.
  //
  // Measured from bounding rects rather than `tab.offsetLeft`. `offsetLeft` is relative to the
  // nearest *positioned* ancestor, and wrapping each tab in a `relative` drop zone made that
  // wrapper the offset parent — so every tab reported ~0 and the strip scrolled to the start
  // instead of to the active day. On a 7-day trip that left days 5-7 permanently off-screen: the
  // arrows moved the selection but the strip never followed. Rects are independent of layout
  // ancestry, so this can't be re-broken by wrapping the tabs in something else.
  useEffect(() => {
    const strip = dayTabStripRef.current;
    const tab = dayTabRefs.current[dayIndex];
    if (!strip || !tab) return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const offsetWithinStrip = tabBox.left - stripBox.left + strip.scrollLeft;
    strip.scrollTo({
      left: offsetWithinStrip - (strip.clientWidth - tabBox.width) / 2,
      behavior: "smooth",
    });
  }, [dayIndex]);

  if (!day) {
    return (
      <div className="glass-itinerary rounded-none p-5 sm:rounded-2xl sm:p-6">
        <p className="text-sm text-muted">
          This plan came back with no days in it. Try generating it again.
        </p>
      </div>
    );
  }

  // Scoped to day 1 only — see the `animateReveal` prop doc above.
  const revealingStops = !!animateReveal && dayIndex === 0;
  // The shown day's findings, plus trip-wide ones (budget), which belong on whatever day is up.
  const dayFindings: Guardrail[] = findings.filter(
    (f) => f.dayIndex === dayIndex || f.dayIndex === null
  );
  const { tiles, total } = dayBreakdown(day);
  const tier = TIERS.find((t) => t.id === itinerary.tier);
  const dayCount = itinerary.days.length;

  /** A tab moves focus as well as selection, so the arrow keys walk the row the way a
   *  tablist is expected to rather than leaving many tabs to be reached one Tab at a time. */
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const next = { ArrowRight: dayIndex + 1, ArrowLeft: dayIndex - 1, Home: 0, End: dayCount - 1 }[
      e.key
    ];
    if (next == null) return;
    e.preventDefault();
    const clamped = Math.max(0, Math.min(dayCount - 1, next));
    setActiveDayIndex(clamped);
    dayTabRefs.current[clamped]?.focus();
  };

  const selectStop = (stop: Stop) => {
    // The card stays mounted behind the place detail, so the tour's interval survives with it —
    // and a camera that keeps flying every few seconds while someone reads about one place is
    // worse than the old accidental stop.
    stopTour();
    onSelectStop(stop);
  };

  const arrowClass =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-30";
  const arrowStyle = { background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.15)" };

  return (
    <div
      // `overflow-clip`, not `overflow-hidden`: both clip the photo to the rounded corners, but
      // `hidden` makes this element a scroll container, and a `position: sticky` child sticks to
      // its nearest scrollport — which would be this box, which never scrolls, so the header
      // simply would not stick. `clip` creates no scrollport, so the header sticks to the panel
      // body it actually scrolls in.
      className="glass-itinerary overflow-clip rounded-none sm:rounded-2xl"
      {...devLabel("ItineraryCard")}
    >
      {/* The min-height is the photo's frame, so it only exists when there is a photo. The
          header photo is a best-effort Wikipedia lookup that legitimately misses, and an
          unconditional 14/18rem left a 288px slab of flat slate above the day badge with the
          title marooned at its bottom edge — a reserved space for a value that isn't there,
          which is the one thing this system says not to render. Without the photo the band
          sizes to the title and the panel simply starts higher. */}
      <div
        ref={heroRef}
        className={`relative flex flex-col justify-end p-5 text-on-deep sm:p-6 ${
          headerPhoto
            ? // Sticky, and sized by `--hero-p` — see `.itinerary-hero` in globals.css and the
              // scroll effect above. `z-20` keeps it over the day tabs sliding under it.
              "itinerary-hero sticky top-0 z-20 overflow-hidden"
            : ""
        }`}
        style={{ backgroundColor: "var(--surface-deep)" }}
        {...devLabel("ItineraryCard.Header")}
      >
        {headerPhoto && (
          // A real photographic moment, not a blurred backdrop — next/image (fill), not a
          // CSS background-image, since this box is overflow-hidden and would otherwise risk
          // a GPU-layer softened blur independent of the source photo's own resolution.
          <Image
            key={headerPhoto}
            src={headerPhoto}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 520px"
            className="value-in object-cover contrast-105 saturate-110"
          />
        )}
        {/* Same bottom-up scrim recipe as the Memories hero tiles: 0.95 where the heading
            sits, 0.5 at 38%, transparent by 70% — darken over a photo whose brightness is
            unknown ahead of time. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgb(var(--surface-deep-rgb) / 0.95), rgb(var(--surface-deep-rgb) / 0.5) 38%, transparent 70%)",
          }}
        />
        {headerPhoto && onMinimize && (
          // The handle, on the photograph rather than on a bar above it. Centred at the top edge
          // where a sheet's grab indicator belongs; the 40px-tall button around it is the hit
          // target, and the 32x4 line is the part that reads as "this pulls away".
          <button
            type="button"
            onClick={onMinimize}
            aria-label="Show the map"
            className="group absolute inset-x-0 top-0 z-30 flex h-10 cursor-pointer items-start justify-center pt-2 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
          >
            {/* Over photography whose brightness is unknown ahead of time — a white line alone
                vanishes against a bright sky or a gold roof — so it carries its own shadow rather
                than relying on the scrim, which is bottom-up and reaches nothing up here. */}
            <span
              className="h-1 w-8 rounded-full bg-white/70 transition-colors group-hover:bg-white group-focus-visible:bg-white"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.55)" }}
            />
          </button>
        )}
        {headerPhoto && (
          // The compact title, which is what the header *becomes*. It arrives as the large one
          // leaves — the same trade an iOS large title makes — so the collapsed strip still says
          // where you are and which day you are on, in one line the height of the photo it sits on.
          <div
            aria-hidden="true"
            className="itinerary-hero-compact pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-full items-center gap-2 px-5 sm:px-6"
          >
            <span className="truncate text-sm font-semibold text-on-deep">
              {cityName(destination)}
            </span>
            <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-accent-foreground uppercase">
              Day {dayIndex + 1}
            </span>
          </div>
        )}
        <div
          className={`relative z-10 flex flex-col gap-1 ${headerPhoto ? "itinerary-hero-full" : ""}`}
        >
          {/* The active day, not the trip's day count — a "where am I right now" stamp, so
              it moves with dayIndex rather than staying fixed. */}
          <span className="mb-1 inline-block w-fit -rotate-2 rounded bg-accent px-2 py-1 text-xs font-bold tracking-wide text-accent-foreground uppercase">
            Day {dayIndex + 1} of {dayCount}
          </span>
          <h1 className="font-display text-2xl font-semibold italic">
            {cityName(destination)}: {dayCount} day{dayCount > 1 ? "s" : ""}
          </h1>
          <p className="text-sm opacity-90">{tier ? `${tier.name} · ${tier.description}` : ""}</p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <BudgetBar
          days={itinerary.days}
          budget={budget}
          flightCostUsd={itinerary.flightCostUsd}
        />
      </div>

      <div className="flex items-center gap-2 px-5 pb-3 sm:px-6" {...devLabel("ItineraryCard.DayTabs")}>
        <button
          type="button"
          onClick={() => setActiveDayIndex((i) => Math.max(0, i - 1))}
          disabled={dayIndex === 0}
          aria-label="Previous day"
          className={arrowClass}
          style={arrowStyle}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>

        <div
          ref={dayTabStripRef}
          role="tablist"
          aria-label="Trip days"
          aria-orientation="horizontal"
          className="scrollbar-none flex gap-1.5 overflow-x-auto"
        >
          {itinerary.days.map((d, i) => {
            const isFirst = i === 0;
            const isActive = i === dayIndex;
            // Right edge is an arrow point; tabs after the first also carry a matching notch on
            // their left edge, so the row reads as a sequence rather than separate buttons.
            const clipPath = isFirst
              ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
              : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)";
            return (
              <button
                key={i}
                id={`day-tab-${i}`}
                ref={(el) => {
                  dayTabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="day-panel"
                // Roving tabindex: the row is one stop in the tab order, and the arrow keys
                // move within it.
                tabIndex={isActive ? 0 : -1}
                onKeyDown={onTabKeyDown}
                onClick={() => setActiveDayIndex(i)}
                style={{ clipPath }}
                className={`shrink-0 py-3 pr-7 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${
                  isFirst ? "pl-5" : "pl-7"
                } ${
                  isActive
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "bg-white/10 text-muted hover:bg-white/15"
                }`}
              >
                Day {i + 1}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setActiveDayIndex((i) => Math.min(dayCount - 1, i + 1))}
          disabled={dayIndex === dayCount - 1}
          aria-label="Next day"
          className={arrowClass}
          style={arrowStyle}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div
        id="day-panel"
        role="tabpanel"
        aria-labelledby={`day-tab-${dayIndex}`}
        className="px-5 pb-5 sm:px-6 sm:pb-6"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <DayHeader
              day={day}
              dayIndex={dayIndex}
              animateReveal={animateReveal}
              editable={editable}
              onEditDay={onEditDay}
              // The pencil opens the full-page board rather than an inline form: renaming a day
              // and rearranging it are the same job, and the board can do both with every day in
              // view. `isEditing` stays false so the inline rename form never takes over the
              // header — the board owns that now.
              isEditing={false}
              onEditingChange={(editing) => {
                if (editing && canRearrange) setBoardOpen(true);
              }}
            />
          </div>
          {/* Mode A, day-scoped. Sits beside the day header because that is the day's own
              edit affordance — the whole-trip equivalent lives with the save/refine actions.

              An icon alone did not say what it did, so the label unfurls on hover and on
              keyboard focus. Three decisions in here are load-bearing:

              The 28px wrapper holds the collapsed footprint and the button is absolutely
              positioned inside it, anchored `right-0`. So the pill grows *leftward* out of the
              icon, the icon itself never moves out from under the cursor, and the DayHeader
              sibling — `min-w-0 flex-1`, i.e. free to be squeezed — is not reflowed on every
              frame of the expansion. Growing it in flow instead would rewrap the day title
              while the label slid out.

              `max-width`, and the `grid-cols-[0fr]` -> `[1fr]` trick was tried here first and
              does not work. `fr` is a fraction of *free* space, so it needs a definite
              container size to resolve against; this button is absolutely positioned and
              shrink-to-fit, so its width depends on the grid whose track depends on its width,
              and the browser breaks that circularity by resolving the track to its minimum.
              Measured: `grid-template-columns` computed to `6px` — the label's padding and
              nothing else — in *both* states, so the label never appeared at all. `max-width`
              is indifferent to container definiteness, which is what makes it the right tool
              inside a shrink-to-fit box. Its one cost is that the transition visually finishes
              once max-width passes the text's natural width — measured at 77px in both engines,
              against an 88px ceiling, so the motion lands at about 88% of the 300ms. The
              remaining 11px of slack is deliberate and is not worth reclaiming: tightening the
              ceiling to the measured width buys an imperceptible 12% of timing and risks
              clipping the label outright on any system whose fallback face sets wider than
              Archivo before the webfont lands.

              The 6px gap is `mr` on the label, not `gap` on the button, so one transition
              drives both and they cannot drift apart. It has to be margin and not padding:
              `overflow: hidden` clips *content*, and a padding box cannot shrink below its own
              padding, so `pr-1.5` on a `max-w-0` span left 6px of dead width behind — the
              collapsed button measured 34px instead of 28px.

              The expanded chip is opaque slate, not the `bg-white/10` wash this button used to
              take, and that is a legibility fix rather than a style choice. DayHeader is
              `justify-between` with `WeatherBadge` pinned right, so the 83px the label needs is
              exactly the space the weather chip occupies — measured overlap, 75px. Expanding in
              flow instead is worse, not better: DayHeader is `flex-wrap`, so squeezing it wraps
              the badge onto a second line and the whole row jumps taller. So the pill covers the
              badge for as long as the pointer is on it, and it has to do that opaquely, over a
              `.glass-itinerary` backdrop that is 0.62 slate over a live and often bright map.
              The control shadow and a hairline ring lift it off the chip underneath — without
              them its left edge cut the weather text mid-glyph with no separation, which read as
              a clipping bug rather than as one object in front of another. `ring` rather than
              `border` because a border would widen the collapsed 28px footprint.

              The label is not a second accessible name: `aria-label` leads with the same words
              it renders, so the accessible name contains the visible one (WCAG Label in Name)
              while still carrying the day. The old `title` is gone — a native tooltip repeating
              a label that is now visible on hover is noise, and it would have faded in on top
              of the expanded pill a second later. Reduced motion needs nothing here; the
              blanket rule in globals.css collapses both transitions to 0.01ms. */}
          {onChatDay && (
            <div className="relative h-7 w-7 shrink-0">
              <button
                type="button"
                onClick={() => onChatDay(dayIndex)}
                aria-label={`Refine with AI — day ${dayIndex + 1}`}
                className="group absolute top-0 right-0 flex items-center rounded-md p-1.5 text-muted shadow-none transition-[background-color,color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[rgb(var(--surface-deep-rgb))] hover:text-foreground hover:shadow-[0_4px_16px_rgba(0,0,0,0.32)] hover:ring-1 hover:ring-card-border focus-visible:bg-[rgb(var(--surface-deep-rgb))] focus-visible:text-foreground focus-visible:shadow-[0_4px_16px_rgba(0,0,0,0.32)] focus-visible:ring-1 focus-visible:ring-card-border"
              >
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium transition-[max-width,margin-right] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:mr-1.5 group-hover:max-w-[5.5rem] group-focus-visible:mr-1.5 group-focus-visible:max-w-[5.5rem]">
                  Refine with AI
                </span>
                <Sparkles className="h-4 w-4 shrink-0" />
              </button>
            </div>
          )}
        </div>

        {day.summary && <p className="mb-3 text-sm italic text-muted">{day.summary}</p>}

        {/* Only worth offering when there is more than one place to move between. */}
        {day.stops.length > 1 && (
          <button
            type="button"
            onClick={toggleTour}
            className="mb-3 flex min-h-11 items-center gap-2 rounded-full bg-tag-neutral-bg px-4 text-xs font-medium text-foreground transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {touring ? (
              <PauseIcon className="h-3.5 w-3.5 text-accent" />
            ) : (
              <PlayIcon className="h-3.5 w-3.5 text-accent" />
            )}
            {touring ? "Stop tour" : "Play tour"}
          </button>
        )}

        {day.lodging && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-white/10 p-3">
            <LodgingIcon className="h-5 w-5 shrink-0 text-accent" />
            {/* `basis-40` is what makes the wrap actually happen on a phone: with `flex-1`
                alone the name shrank to fit beside the input instead. */}
            <div className="min-w-0 flex-1 basis-40">
              <div className="font-medium text-foreground">{day.lodging.name}</div>
              <div className="text-sm text-muted">
                {[day.lodging.note, formatMoney(day.lodging.cost)].filter(Boolean).join(" · ")}
              </div>
            </div>
            {editable && onLodgingActualCostChange && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                Actual
                <span className="relative flex items-center">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 text-base text-muted"
                  >
                    $
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    defaultValue={day.lodging.actualCost}
                    onBlur={(e) =>
                      onLodgingActualCostChange(
                        dayIndex,
                        e.target.value === "" ? undefined : Number(e.target.value)
                      )
                    }
                    // Enter commits, because a value typed and left uncommitted is a value
                    // silently lost.
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    // 16px, not 12px: below 16px iOS Safari zooms the whole viewport on focus.
                    className="h-11 w-24 rounded-md border border-card-border bg-white/10 pr-2 pl-6 text-base tabular-nums text-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  />
                </span>
              </label>
            )}
          </div>
        )}

        {day.stops.length === 0 ? (
          <p className="text-sm text-muted">
            No stops planned for this day — it&rsquo;s yours to fill.
          </p>
        ) : (
          <StopList
            stops={day.stops}
            revealedCount={revealedCount}
            onSelect={selectStop}
            // Bidirectional highlight: a row lights up when its marker card on the globe
            // is hovered or stepped onto by the tour, and hovering a row lights its
            // marker. Both surfaces read and write the same context index, so neither
            // knows the other exists.
            highlightedIndex={highlightedRow}
            onHoverStop={(index) => setHoveredIndex(index === null ? null : dayOffset + index)}
            revealAnimation={revealingStops}
          />
        )}

        {/* Findings for the day on screen, plus the trip-wide budget one. Computed locally, so
            they appear the instant a drop lands rather than after a model round trip. */}
        {dayFindings.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {dayFindings.map((finding, i) => (
              <li
                key={i}
                className="flex gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-2 text-xs text-amber-200"
              >
                <span aria-hidden="true">⚠️</span>
                <span>{finding.message}</span>
              </li>
            ))}
          </ul>
        )}

        {canRearrange && itinerary.days.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted/70">
              Editing keeps the map beside you, so a move between days is a decision you can see.
            </p>
            <button
              type="button"
              onClick={() => setBoardOpen(true)}
              className="shrink-0 rounded-full border border-card-border bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/20"
            >
              Edit itinerary
            </button>
          </div>
        )}
      </div>


      {/* The band's ground is constant. It used to branch on whether the header photo had
          resolved yet, so the tiles' background/border/text changed a second after paint;
          now the photo arrives behind an unchanged surface and only adds texture. */}
      <div
        className="relative overflow-hidden border-t border-card-border p-5 sm:p-6"
        style={{ backgroundColor: "rgb(var(--surface-deep-rgb) / 0.7)" }}
        {...devLabel("ItineraryCard.BudgetBreakdown")}
      >
        {headerPhoto && (
          <BlurredPhotoLayer
            photo={headerPhoto}
            tint="linear-gradient(rgb(var(--surface-deep-rgb) / 0.55), rgb(var(--surface-deep-rgb) / 0.8))"
          />
        )}
        <div className="relative z-10">
          <h3 className="mb-3 text-sm font-semibold text-on-deep">Day {dayIndex + 1} spend</h3>
          {/* flex-wrap rather than a fixed column count: the tile count is 0-5 depending on
              what the day actually cost money on, and wrap stretches whatever lands in the
              last row instead of orphaning it at half width. */}
          {tiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {/* No `backdrop-blur` on these tiles, and up to five of them are on screen at once.
                  There is nothing left to blur: this band's own ground is `--surface-deep` at
                  0.7, over BlurredPhotoLayer's already-blurred header photo, inside
                  `.glass-itinerary`'s 56px pass. Blurring an already-flat backdrop through a 25%
                  black fill is visually identical to the fill alone, for five extra render
                  surfaces on the panel that gets scrolled most. `bg-black/25` stays — a blur does
                  not darken; `bg-black/30` is the knob if the row reads busy over an unusually
                  high-contrast photo. */}
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  className="flex min-w-24 max-w-48 flex-1 flex-col items-center rounded-xl border border-white/20 bg-black/25 p-3 text-center text-on-deep"
                >
                  <tile.Icon className="h-4 w-4" />
                  <div className="mt-1 text-xs opacity-90">{tile.label}</div>
                  <div className="font-semibold tabular-nums">
                    {animateReveal ? (
                      <Typewriter key={`${dayIndex}-${tile.label}`} text={formatMoney(tile.amount)} />
                    ) : (
                      formatMoney(tile.amount)
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Total is the sum of the row above it, so it reads as a rule beneath them rather
              than as a sixth peer. Amber is opaque, so unlike the black-tinted tiles it is
              unaffected by whatever photo lands behind the band. */}
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-accent px-4 py-3 text-accent-foreground">
            <span className="text-sm font-medium">Total</span>
            <span className="font-semibold tabular-nums">
              {animateReveal ? (
                <Typewriter key={`${dayIndex}-total`} text={formatMoney(total)} />
              ) : (
                formatMoney(total)
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Rendered from here so the card owns the state that opens it, but portalled to the body
          inside SplitEditor — a fixed panel cannot live inside a `backdrop-filter` ancestor,
          which contains `position: fixed` and would trap it in this 520px column.
          `ArrangeBoard`, the full-screen board this replaced, is still on disk with no importers
          — kept for one release in case the split proves wrong, and safe to delete after. */}
      {boardOpen && trip && onItineraryChange && (
        <SplitEditor
          trip={trip}
          itinerary={itinerary}
          onItineraryChange={onItineraryChange}
          onClose={() => setBoardOpen(false)}
        />
      )}
    </div>
  );
}
