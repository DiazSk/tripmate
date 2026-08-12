"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { DayPlan, Itinerary, Stop, StopCategory } from "@/lib/types";
import { DayWeather } from "@/lib/weather";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import { useMapCamera } from "@/lib/mapCamera";
import { useStopTour } from "@/lib/useStopTour";
import { daySpendByCategory } from "@/lib/itinerary";
import { formatDateWithWeekday, formatMoney } from "@/lib/format";
import BudgetBar from "./BudgetBar";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudIcon,
  EntryIcon,
  FoodIcon,
  LodgingIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  RainIcon,
  SunIcon,
  TransitIcon,
} from "./icons";

const CATEGORY_ICON: Record<StopCategory, typeof FoodIcon> = {
  food: FoodIcon,
  entry: EntryIcon,
  transit: TransitIcon,
  other: PinIcon,
};

function cityName(destination: string): string {
  return destination.split(",")[0].trim();
}

function BlurredPhotoLayer({ photo, tint }: { photo: string; tint: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="value-in absolute inset-0 scale-110 bg-cover bg-center blur-lg"
        style={{ backgroundImage: `url(${photo})` }}
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: tint }} />
    </>
  );
}

const TEMP_WORDS = ["hot", "warm", "mild", "cool", "cold"] as const;

interface WeatherRead {
  Icon: typeof SunIcon;
  temp: string | null;
  label: string | null;
  /** Rain probability as a percentage, when a real forecast supplied one. */
  rain: number | null;
  /** True when the figures are last year's same-date weather, not a live forecast. */
  typical: boolean;
}

/** WMO weather codes, as returned by Open-Meteo. Mapped onto the three weather
 *  icons the system draws — the point is the condition, not a taxonomy. */
function readForecast(w: DayWeather): WeatherRead {
  const code = w.weatherCode;
  const temp =
    Number.isFinite(w.tempMinC) && Number.isFinite(w.tempMaxC)
      ? `${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°C`
      : null;
  const base = { temp, rain: w.precipitationProbability, typical: w.historical };

  if (code == null) return { ...base, Icon: SunIcon, label: null };
  if (code >= 95) return { ...base, Icon: RainIcon, label: "Thunderstorms" };
  if (code >= 85) return { ...base, Icon: CloudIcon, label: "Snow showers" };
  if (code >= 80) return { ...base, Icon: RainIcon, label: "Showers" };
  if (code >= 71) return { ...base, Icon: CloudIcon, label: "Snow" };
  if (code >= 61) return { ...base, Icon: RainIcon, label: "Rain" };
  if (code >= 51) return { ...base, Icon: RainIcon, label: "Drizzle" };
  if (code >= 45) return { ...base, Icon: CloudIcon, label: "Fog" };
  if (code === 3) return { ...base, Icon: CloudIcon, label: "Overcast" };
  if (code >= 1) return { ...base, Icon: CloudIcon, label: "Partly cloudy" };
  return { ...base, Icon: SunIcon, label: "Clear" };
}

/**
 * Fallback for itineraries saved before `weatherDetail` existed: condense the
 * model's free text ("Warm (24-32°C) with high rain chance (63%)") to an icon and
 * a temperature. It deliberately returns a null label rather than guessing —
 * "Windy and grey" used to come back as a sun captioned "Clear".
 */
function readProse(weather: string): WeatherRead {
  const lower = (weather ?? "").toLowerCase();
  // The decimal part is not optional decoration: the model writes "13.6-21°C", and a
  // `\d+` that can't span the ".6" matched the *fragment* "6-21" and printed 6–21°C.
  const num = String.raw`-?\d+(?:\.\d+)?`;
  const range = weather?.match(new RegExp(`(${num})\\s*[-–—]\\s*(${num})\\s*°?\\s*C`, "i"));
  const single = weather?.match(new RegExp(`(${num})\\s*°\\s*C`, "i"));
  const temp = range
    ? `${Math.round(Number(range[1]))}–${Math.round(Number(range[2]))}°C`
    : single
      ? `${Math.round(Number(single[1]))}°C`
      : null;
  const base = { temp, rain: null, typical: false };

  if (/rain|shower|storm|wet/.test(lower)) return { ...base, Icon: RainIcon, label: "Rain likely" };
  if (/snow|sleet/.test(lower)) return { ...base, Icon: CloudIcon, label: "Snow" };
  if (/cloud|overcast/.test(lower)) return { ...base, Icon: CloudIcon, label: "Cloudy" };
  if (/clear|sunny|sun\b/.test(lower)) return { ...base, Icon: SunIcon, label: "Clear" };
  const word = TEMP_WORDS.find((w) => lower.includes(w));
  return {
    ...base,
    Icon: SunIcon,
    label: word ? word[0].toUpperCase() + word.slice(1) : null,
  };
}

/** Everything the badge knows is printed in it. The rain chance and the
 *  typical-weather caveat used to live only in a `title` on a non-focusable span,
 *  which is to say nowhere for anyone on a keyboard or a phone. */
function WeatherBadge({ day }: { day: DayPlan }) {
  const { Icon, temp, label, rain, typical } = day.weatherDetail
    ? readForecast(day.weatherDetail)
    : readProse(day.weather);
  if (!temp && !label) return null;

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-full bg-tag-neutral-bg/60 px-2.5 py-1 text-xs">
      <Icon className="h-4 w-4 shrink-0 text-accent" />
      {temp && <span className="font-medium tabular-nums text-tag-neutral-fg">{temp}</span>}
      {label && <span className="text-tag-neutral-fg/70">{label}</span>}
      {rain != null && rain > 0 && (
        <span className="text-tag-neutral-fg/70">
          · <span className="tabular-nums">{rain}%</span> rain
        </span>
      )}
      {typical && <span className="text-tag-neutral-fg/70">· typical</span>}
    </span>
  );
}

function tagStyle(tag: string): string {
  const lower = tag.toLowerCase();
  if (/\bai\b/.test(lower)) return "bg-tag-highlight-bg text-tag-highlight-fg";
  if (lower.includes("local") || lower.includes("free") || lower.includes("recommend") || lower.includes("must"))
    return "bg-tag-positive-bg text-tag-positive-fg";
  return "bg-tag-neutral-bg text-tag-neutral-fg";
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

/** The category tile is the base layer and never unmounts; the photo resolves over
 *  it on `.value-in`. Swapping one for the other made every avatar in the list
 *  jump at whatever moment its Wikipedia lookup happened to land. */
function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  const [failed, setFailed] = useState(false);
  // `?? PinIcon` is the crash guard behind normalizeCategory at the parse boundary,
  // not a second validation: rendering `<undefined />` throws, and one wrong glyph
  // beats a white screen.
  const Icon = CATEGORY_ICON[category] ?? PinIcon;

  return (
    <span className="relative block h-10 w-10 shrink-0">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tag-neutral-bg text-accent">
        <Icon className="h-4 w-4" />
      </span>
      {photo && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
        <img
          src={photo}
          alt=""
          onError={() => setFailed(true)}
          className="value-in absolute inset-0 h-10 w-10 rounded-full object-cover"
        />
      )}
    </span>
  );
}

function StackedPhoto({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  const [failed, setFailed] = useState(false);
  const Icon = CATEGORY_ICON[category] ?? PinIcon;

  return (
    <div className="relative h-24 w-full">
      <div className="flex h-24 w-full items-center justify-center rounded-xl bg-tag-neutral-bg text-accent">
        <Icon className="h-6 w-6" />
      </div>
      {photo && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
        <img
          src={photo}
          alt=""
          onError={() => setFailed(true)}
          className="value-in absolute inset-0 h-24 w-full rounded-xl object-cover shadow-sm"
        />
      )}
    </div>
  );
}

function StopRow({
  stop,
  index,
  isLast,
  onSelect,
  isHighlighted,
  onHover,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  onSelect: (stop: Stop) => void;
  /** True when this stop's marker on the globe is hovered or selected. */
  isHighlighted: boolean;
  onHover: (hovered: boolean) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: index * 0.08 }}
      // The highlight is the same wash the `hover:` variant paints, so a row lit from the globe
      // and a row lit by the pointer look identical — which is the point.
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`relative flex gap-3 rounded-xl transition-colors hover:bg-white/5 ${
        isHighlighted ? "bg-white/5" : ""
      }`}
    >
      {!isLast && (
        /* Spans avatar-bottom to next-avatar-top, so it has to stop short of this row's own
           height rather than exceed it: it starts at 2.75rem (top-11, a hair under the 2.5rem
           h-10 avatar) and the next avatar begins at 100% + 1rem (the parent's space-y-4), so
           the height is 100% + 1rem - 2.75rem. The old +0.5rem overshot by 2.25rem and drew
           straight through the following stop's avatar and name. Update this if the avatar
           size or the list gap changes.

           left-6, not left-5: the avatar isn't flush with the row's edge, it sits inside the
           button's own p-1 (0.25rem), so its true center is 0.25rem + 1.25rem (half the h-10
           avatar) = 1.5rem. left-5 (1.25rem) drew the line a hair left of every node. */
        <div className="absolute top-11 left-6 h-[calc(100%-1.75rem)] w-px bg-card-border" />
      )}
      <button
        type="button"
        onClick={() => onSelect(stop)}
        // The globe's marker cards light their paired row on focus as well as on
        // hover (StopMarkerLayer), so the row has to light its marker from focus too
        // or the coupling only works for people using a mouse.
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        className="relative z-10 flex flex-1 gap-3 rounded-xl p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <StopAvatar name={stop.name} category={stop.category} />
        <span className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{stop.name}</div>
          {(stop.time || stop.durationLabel) && (
            <div className="text-sm text-muted">
              {[stop.time, stop.durationLabel].filter(Boolean).join(" · ")}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(stop.tags ?? []).map((tag, ti) => (
              <span
                key={ti}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${tagStyle(tag)}`}
              >
                {tag}
              </span>
            ))}
          </div>
        </span>
      </button>
    </motion.div>
  );
}

export default function ItineraryCard({
  itinerary,
  budget,
  destination,
  onSelectStop,
  onLodgingActualCostChange,
}: {
  itinerary: Itinerary;
  budget: number;
  destination: string;
  onSelectStop: (stop: Stop) => void;
  /** Supplied only on a saved trip, where real spend can be logged against the plan. */
  onLodgingActualCostChange?: (dayIndex: number, value: number | undefined) => void;
}) {
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const headerPhoto = usePlacePhoto(destination, "full");
  const dayIndex = Math.min(activeDayIndex, itinerary.days.length - 1);
  const day = itinerary.days[dayIndex];
  const { showDayRoute, hoveredIndex, setHoveredIndex, activeIndex } = useMapCamera();
  const { playing: touring, toggle: toggleTour, stop: stopTour } = useStopTour();
  const dayTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dayTabStripRef = useRef<HTMLDivElement>(null);

  // Glowing pins + connecting arc for whichever day is active, redrawn on every day-tab switch.
  useEffect(() => {
    if (!day) return;
    showDayRoute(day.stops.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name })));
  }, [day, showDayRoute]);

  // Keep the active day tab scrolled into view, including when the arrows below move it.
  //
  // The strip is scrolled directly rather than via `tab.scrollIntoView()`. That call
  // walks *every* scrollable ancestor, so even with `block: "nearest"` it scrolled the
  // docked panel itself — on mount it pushed the panel down ~100px and hid the surface's
  // own top row. Setting `scrollLeft` on the one element that should move touches nothing
  // else, and centring reads better than "nearest" on a 30-day row.
  useEffect(() => {
    const strip = dayTabStripRef.current;
    const tab = dayTabRefs.current[dayIndex];
    if (!strip || !tab) return;
    strip.scrollTo({
      left: tab.offsetLeft - (strip.clientWidth - tab.clientWidth) / 2,
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

  const { tiles, total } = dayBreakdown(day);
  const photoStops = day.stops.slice(0, 3);
  const tier = TIERS.find((t) => t.id === itinerary.tier);
  const dayCount = itinerary.days.length;

  /** A tab moves focus as well as selection, so the arrow keys walk the row the way
   *  a tablist is expected to rather than leaving 30 tabs to be reached one Tab at
   *  a time. */
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
    // The card stays mounted behind the place detail, so the tour's interval
    // survives with it — and a camera that keeps flying every few seconds while
    // someone reads about one place is worse than the old accidental stop.
    stopTour();
    onSelectStop(stop);
  };

  const arrowClass =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="glass-itinerary overflow-hidden rounded-none sm:rounded-2xl">
      <div
        className="relative flex min-h-[14rem] flex-col justify-end overflow-hidden p-5 text-on-deep sm:min-h-[18rem] sm:p-6"
        style={{ backgroundColor: "var(--surface-deep)" }}
      >
        {headerPhoto && (
          // A real photographic moment now, not a blurred backdrop — next/image
          // (fill), not a CSS background-image, per the Optimized-Photo Rule:
          // this box is overflow-hidden and would otherwise risk a GPU-layer
          // softened blur independent of the source photo's own resolution.
          <Image
            key={headerPhoto}
            src={headerPhoto}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 520px"
            className="value-in object-cover contrast-105 saturate-110"
          />
        )}
        {/* Same bottom-up scrim recipe as the Memories hero tiles: 0.95 where the
            heading sits, 0.5 at 38%, transparent by 70% — the Darken-Never-Lighten
            Rule over a photo whose brightness is unknown ahead of time. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgb(var(--surface-deep-rgb) / 0.95), rgb(var(--surface-deep-rgb) / 0.5) 38%, transparent 70%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-1">
          {/* The active day, not the trip's day count — this is a "where am I right
              now" stamp, so it has to move with dayIndex rather than stay fixed. */}
          <span className="mb-1 inline-block w-fit -rotate-2 rounded bg-accent px-2 py-1 text-xs font-bold tracking-wide text-accent-foreground uppercase">
            Day {dayIndex + 1} of {dayCount}
          </span>
          {/* h1: this card is the top of its surface on both the result step and
              /trip/[id], neither of which had a level-1 heading at all. */}
          <h1 className="font-display text-2xl font-semibold italic">
            {cityName(destination)}: {dayCount} day{dayCount > 1 ? "s" : ""}
          </h1>
          {/* The tier's own name, which until now existed only inside the prompt —
              the card described the style without ever telling you what it was called. */}
          <p className="text-sm opacity-90">
            {tier ? `${tier.name} · ${tier.description}` : ""}
          </p>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <BudgetBar days={itinerary.days} budget={budget} />
      </div>

      <div className="flex items-center gap-2 px-5 pb-3 sm:px-6">
        <button
          type="button"
          onClick={() => setActiveDayIndex((i) => Math.max(0, i - 1))}
          disabled={dayIndex === 0}
          aria-label="Previous day"
          className={arrowClass}
          style={{ background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.15)" }}
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
                // Roving tabindex: the row is one stop in the tab order, and the
                // arrow keys move within it.
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
          style={{ background: "rgba(255, 255, 255, 0.1)", border: "1px solid rgba(255, 255, 255, 0.15)" }}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div id="day-panel" role="tabpanel" aria-labelledby={`day-tab-${dayIndex}`} className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Day {dayIndex + 1} · {formatDateWithWeekday(day.date)}
          </h2>
          <WeatherBadge day={day} />
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
            {/* `basis-40` is what makes the wrap actually happen on a phone: with
                `flex-1` alone the name shrank to fit beside the input instead, and
                "Hotel Pulitzer Paris" came out three lines tall. */}
            <div className="min-w-0 flex-1 basis-40">
              <div className="font-medium text-foreground">{day.lodging.name}</div>
              <div className="text-sm text-muted">
                {[day.lodging.note, formatMoney(day.lodging.cost)].filter(Boolean).join(" · ")}
              </div>
            </div>
            {onLodgingActualCostChange && (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                Actual
                <span className="relative flex items-center">
                  <span aria-hidden="true" className="pointer-events-none absolute left-2.5 text-base text-muted">
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
                    // Enter commits, because a value typed and left uncommitted is a
                    // value silently lost.
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    // 16px, not the 12px this used to be: below 16px iOS Safari zooms
                    // the whole viewport on focus.
                    className="h-11 w-24 rounded-md border border-card-border bg-white/10 pr-2 pl-6 text-base tabular-nums text-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  />
                </span>
              </label>
            )}
          </div>
        )}

        {/* Photo column sits beside the stop list only, so it starts level with the first stop
            rather than alongside the lodging row above it. */}
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            {day.stops.length === 0 ? (
              <p className="text-sm text-muted">
                No stops planned for this day — it&rsquo;s yours to fill.
              </p>
            ) : (
              <div className="space-y-4">
                {day.stops.map((stop, i) => (
                  <StopRow
                    key={i}
                    stop={stop}
                    index={i}
                    isLast={i === day.stops.length - 1}
                    onSelect={selectStop}
                    isHighlighted={hoveredIndex === i || activeIndex === i}
                    onHover={(hovered) => setHoveredIndex(hovered ? i : null)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Desktop only by design: at `sm` the docked panel is 360px wide, and a
              112px photo column off that leaves the stop names nowhere to wrap. */}
          {photoStops.length > 0 && (
            <div className="hidden w-28 shrink-0 flex-col gap-2 lg:flex">
              {photoStops.map((stop, i) => (
                <StackedPhoto key={i} name={stop.name} category={stop.category} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The band's ground is constant. It used to branch on whether the header photo
          had resolved yet, so five tiles changed background, border and text colour
          a second or two after first paint; now the photo arrives behind an
          unchanged surface and only adds texture. */}
      <div
        className="relative overflow-hidden border-t border-card-border p-5 sm:p-6"
        style={{ backgroundColor: "rgb(var(--surface-deep-rgb) / 0.7)" }}
      >
        {headerPhoto && (
          <BlurredPhotoLayer
            photo={headerPhoto}
            tint="linear-gradient(rgb(var(--surface-deep-rgb) / 0.55), rgb(var(--surface-deep-rgb) / 0.8))"
          />
        )}
        <div className="relative z-10">
          {/* Was "Day N — Budget Breakdown", the only Title Case heading in the app. */}
          <h3 className="mb-3 text-sm font-semibold text-on-deep">Day {dayIndex + 1} spend</h3>
          {/* flex-wrap rather than a fixed column count: the tile count is now 0–5
              depending on what the day actually cost money on, and wrap stretches
              whatever lands in the last row instead of orphaning it at half width. */}
          {tiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  // `max-w-48` caps the growth: flex-wrap stretches whatever lands in
                  // the last row, and a single leftover tile filling the full width
                  // read as a banner rather than as one more tile.
                  className="flex min-w-24 max-w-48 flex-1 flex-col items-center rounded-xl border border-white/20 bg-black/25 p-3 text-center text-on-deep backdrop-blur-md"
                >
                  <tile.Icon className="h-4 w-4" />
                  <div className="mt-1 text-xs opacity-90">{tile.label}</div>
                  <div className="font-semibold tabular-nums">{formatMoney(tile.amount)}</div>
                </div>
              ))}
            </div>
          )}
          {/* Total is the sum of the row above it, so it reads as a rule beneath them
              rather than as a sixth peer. Amber is opaque, so unlike the black-tinted
              tiles it is unaffected by whatever photo lands behind the band. */}
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-accent px-4 py-3 text-accent-foreground">
            <span className="text-sm font-medium">Total</span>
            <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
