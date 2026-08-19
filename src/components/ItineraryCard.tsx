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
import ArrangeBoard from "./ArrangeBoard";
import { formatMoney } from "@/lib/format";
import BudgetBar from "./BudgetBar";
import DayHeader, { DayEditUpdates } from "./DayHeader";
import StopList from "./StopList";
import Typewriter from "./Typewriter";
import { devLabel } from "@/lib/devInspector";

/** Ms between each stop's reveal during the post-generation stagger. */
const REVEAL_STEP_MS = 400;
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
  const { showDayRoute, hoveredIndex, setHoveredIndex, activeIndex } = useMapCamera();
  const { playing: touring, toggle: toggleTour, stop: stopTour } = useStopTour();
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

  // Guardrails, recomputed from the itinerary itself rather than remembered from the last drop —
  // so they describe the plan on screen whoever last changed it, the traveler or the model.
  const findings = useMemo(
    () => (canRearrange ? evaluateItinerary(itinerary, { budget }) : []),
    [canRearrange, itinerary, budget]
  );

  useEffect(() => {
    activeDayRef.current = dayIndex;
  }, [dayIndex]);

  // Glowing pins + connecting arc for whichever day is active, redrawn on every day-tab
  // switch — including switching away from day 1 mid-stagger, which is how leaving the
  // animation early works: the new day just shows in full immediately.
  useEffect(() => {
    if (!day) return;
    if (skipNextInstantRevealRef.current) {
      skipNextInstantRevealRef.current = false;
      return;
    }
    setRevealedCount(day.stops.length);
    showDayRoute(day.stops.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name })));
  }, [day, showDayRoute]);

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
      showDayRoute(stops.slice(0, i).map((s) => ({ lat: s.lat, lng: s.lng, name: s.name })));
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
    <div className="glass-itinerary overflow-hidden rounded-none sm:rounded-2xl" {...devLabel("ItineraryCard")}>
      <div
        className="relative flex min-h-[14rem] flex-col justify-end overflow-hidden p-5 text-on-deep sm:min-h-[18rem] sm:p-6"
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
        <div className="relative z-10 flex flex-col gap-1">
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
        <BudgetBar days={itinerary.days} budget={budget} />
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
              edit affordance — the whole-trip equivalent lives with the save/refine actions. */}
          {onChatDay && (
            <button
              type="button"
              onClick={() => onChatDay(dayIndex)}
              aria-label={`Refine day ${dayIndex + 1} with AI`}
              title="Refine this day with AI"
              className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
            </button>
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
            highlightedIndex={hoveredIndex ?? activeIndex}
            onHoverStop={(index) => setHoveredIndex(index)}
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
              Rearranging happens on one page, with every day side by side.
            </p>
            <button
              type="button"
              onClick={() => setBoardOpen(true)}
              className="shrink-0 rounded-full border border-card-border bg-white/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/20"
            >
              Arrange days
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
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  className="flex min-w-24 max-w-48 flex-1 flex-col items-center rounded-xl border border-white/20 bg-black/25 p-3 text-center text-on-deep backdrop-blur-md"
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
          inside ArrangeBoard — a full-screen surface cannot live inside a 520px docked panel. */}
      {boardOpen && trip && onItineraryChange && (
        <ArrangeBoard
          trip={trip}
          itinerary={itinerary}
          editable={editable}
          onEditDay={onEditDay}
          onItineraryChange={onItineraryChange}
          onClose={() => setBoardOpen(false)}
        />
      )}
    </div>
  );
}
