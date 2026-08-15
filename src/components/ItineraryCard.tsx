"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { DayPlan, Itinerary, Stop, StopCategory } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import { useMapCamera } from "@/lib/mapCamera";
import BudgetBar from "./BudgetBar";
import DayHeader, { DayEditUpdates } from "./DayHeader";
import StopList from "./StopList";
import Typewriter from "./Typewriter";
import { devLabel } from "@/lib/devInspector";

/** Ms between each stop's reveal during the post-generation stagger. */
const REVEAL_STEP_MS = 400;
import { ChevronLeftIcon, ChevronRightIcon, EntryIcon, FoodIcon, LodgingIcon, TransitIcon } from "./icons";

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

function dayBreakdown(day: DayPlan) {
  const sums: Record<StopCategory, number> = { food: 0, entry: 0, transit: 0, other: 0 };
  for (const stop of day.stops) sums[stop.category ?? "other"] += stop.cost;
  const stay = day.lodging?.cost ?? 0;
  const total = sums.food + sums.entry + sums.transit + sums.other + stay;
  return [
    { label: "Food", amount: Math.round(sums.food), Icon: FoodIcon },
    { label: "Entry", amount: Math.round(sums.entry), Icon: EntryIcon },
    { label: "Transit", amount: Math.round(sums.transit), Icon: TransitIcon },
    { label: "Stay", amount: Math.round(stay), Icon: LodgingIcon },
    { label: "Total", amount: Math.round(total), Icon: null },
  ];
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
  const { showDayRoute } = useMapCamera();
  const dayTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [revealedCount, setRevealedCount] = useState(animateReveal ? 0 : Infinity);
  const activeDayRef = useRef(dayIndex);
  const staggerStartedRef = useRef(false);
  // The very first "day changed" effect pass fires on mount too — when animating, that pass
  // must defer to the stagger effect below instead of instantly revealing everything.
  const skipNextInstantRevealRef = useRef(!!animateReveal);

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
    showDayRoute(day.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
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
      showDayRoute(stops.slice(0, i).map((s) => ({ lat: s.lat, lng: s.lng })));
      if (i >= stops.length) clearInterval(id);
    }, REVEAL_STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately one-shot on mount
  }, [animateReveal]);

  // Keep the active day tab centered in its scroll row, including when the arrows below move it.
  useEffect(() => {
    dayTabRefs.current[dayIndex]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [dayIndex]);

  if (!day) return null;
  // Scoped to day 1 only — see the `animateReveal` prop doc above.
  const revealingStops = !!animateReveal && dayIndex === 0;
  const breakdown = dayBreakdown(day);
  const tierDescription = TIERS.find((t) => t.id === itinerary.tier)?.description ?? "";

  return (
    <div className="itinerary-glass overflow-hidden" {...devLabel("ItineraryCard")}>
      <div
        className="relative flex min-h-[9rem] flex-col justify-end overflow-hidden p-5 text-on-deep sm:min-h-[11rem] sm:p-6"
        style={{ backgroundColor: "var(--surface-deep)" }}
        {...devLabel("ItineraryCard.Header")}
      >
        {headerPhoto && (
          /* Both stops come from --surface-deep so the tint matches the flat
             no-photo fallback above and the panel around it. A scrim's job is to
             darken, which is why this can't ride on --accent any more — the
             accent is a light colour now. */
          <BlurredPhotoLayer
            photo={headerPhoto}
            tint="linear-gradient(rgb(var(--surface-deep-rgb) / 0.35), rgb(var(--surface-deep-rgb) / 0.88))"
          />
        )}
        <div className="relative z-10 flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold">
            {cityName(destination)}: {itinerary.days.length} Day{itinerary.days.length > 1 ? "s" : ""}
          </h2>
          <p className="text-sm opacity-90">
            {tierDescription} · ${budget} budget
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <BudgetBar days={itinerary.days} budget={budget} />
      </div>

      <div className="flex items-center gap-2 px-5 pt-4 pb-3 sm:px-6" {...devLabel("ItineraryCard.DayTabs")}>
        <button
          type="button"
          onClick={() => setActiveDayIndex((i) => Math.max(0, i - 1))}
          disabled={dayIndex === 0}
          aria-label="Previous day"
          className="day-arrow flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>

        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {itinerary.days.map((d, i) => {
            const isFirst = i === 0;
            // Right edge is an arrow point; tabs after the first also carry a matching notch on
            // their left edge, so the row reads as a sequence rather than separate buttons.
            const clipPath = isFirst
              ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
              : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)";
            return (
              <button
                key={i}
                ref={(el) => {
                  dayTabRefs.current[i] = el;
                }}
                type="button"
                onClick={() => setActiveDayIndex(i)}
                style={{ clipPath }}
                className={`shrink-0 py-2 pr-7 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${
                  isFirst ? "pl-5" : "pl-7"
                } ${
                  i === dayIndex
                    ? "bg-accent text-accent-foreground"
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
          onClick={() =>
            setActiveDayIndex((i) => Math.min(itinerary.days.length - 1, i + 1))
          }
          disabled={dayIndex === itinerary.days.length - 1}
          aria-label="Next day"
          className="day-arrow flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <DayHeader
              day={day}
              dayIndex={dayIndex}
              animateReveal={animateReveal}
              editable={editable}
              onEditDay={onEditDay}
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

        {day.lodging && (
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/10 p-3">
            <LodgingIcon className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">{day.lodging.name}</div>
              <div className="text-sm text-muted">{day.lodging.note}</div>
            </div>
            {editable && onLodgingActualCostChange && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                Actual
                <input
                  type="number"
                  min={0}
                  defaultValue={day.lodging.actualCost}
                  onBlur={(e) =>
                    onLodgingActualCostChange(
                      dayIndex,
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                  className="w-20 rounded-md border border-card-border bg-white/10 px-2 py-1 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25"
                />
              </label>
            )}
          </div>
        )}

        <StopList
          stops={day.stops}
          revealedCount={revealedCount}
          onSelect={onSelectStop}
          revealAnimation={revealingStops}
        />
      </div>

      <div
        className={`relative overflow-hidden border-t border-card-border p-5 sm:p-6 ${
          headerPhoto ? "" : "bg-tag-neutral-bg/30"
        }`}
        {...devLabel("ItineraryCard.BudgetBreakdown")}
      >
        {headerPhoto && (
          <BlurredPhotoLayer
            photo={headerPhoto}
            tint="linear-gradient(rgb(var(--surface-deep-rgb) / 0.55), rgb(var(--surface-deep-rgb) / 0.8))"
          />
        )}
        <div className="relative z-10">
          <div
            className={`mb-3 text-sm font-semibold ${headerPhoto ? "text-on-deep" : "text-foreground"}`}
          >
            Day {dayIndex + 1} — Budget Breakdown
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {breakdown.map((tile) => {
              const isTotal = tile.label === "Total";
              // Over the photo band the tiles are black-tinted glass rather than white-tinted:
              // a bright photo behind a white-tinted tile drops the label to ~2.5:1, while
              // darkening holds >4.5:1 whatever the photo happens to be. Without a photo the
              // band is already dark (a faint white wash over the panel), so the tiles just
              // take flat neutral fills — and only Total takes the amber accent, keeping the
              // "one accent" rule that the rest of the palette follows.
              const surface = headerPhoto
                ? `border text-on-deep backdrop-blur-md ${
                    isTotal ? "border-white/40 bg-black/40" : "border-white/20 bg-black/25"
                  }`
                : isTotal
                  ? "bg-accent text-accent-foreground"
                  : "bg-tile text-tile-foreground";
              return (
                <div
                  key={tile.label}
                  className={`flex flex-col items-center rounded-xl p-3 text-center ${surface}`}
                >
                  {tile.Icon && <tile.Icon className="h-4 w-4" />}
                  <div className="mt-1 text-xs opacity-90">{tile.label}</div>
                  <div className="font-semibold tabular-nums">
                    {animateReveal ? (
                      <Typewriter key={`${dayIndex}-${tile.label}`} text={`$${tile.amount}`} />
                    ) : (
                      `$${tile.amount}`
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
