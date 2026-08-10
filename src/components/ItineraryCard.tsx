"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { DayPlan, Itinerary, Stop, StopCategory } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import { useMapCamera } from "@/lib/mapCamera";
import BudgetBar from "./BudgetBar";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudIcon,
  EntryIcon,
  FoodIcon,
  LodgingIcon,
  PinIcon,
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
        className="absolute inset-0 scale-110 bg-cover bg-center blur-lg"
        style={{ backgroundImage: `url(${photo})` }}
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: tint }} />
    </>
  );
}

/** "2026-09-10" -> "09-10-26". Returns the input unchanged if it isn't an ISO date. */
function shortDate(iso: string): string {
  const parts = (iso ?? "").split("-");
  if (parts.length !== 3) return iso ?? "";
  const [y, m, d] = parts;
  return `${m}-${d}-${y.slice(2)}`;
}

const TEMP_WORDS = ["hot", "warm", "mild", "cool", "cold"] as const;

/**
 * The model returns free-text weather ("Warm (24-32°C) with high rain chance (63%) - indoor
 * activities favored"). Condense it to an icon, a temperature, and a one-word condition; the
 * full sentence stays available as a tooltip.
 */
function weatherSummary(weather: string) {
  const lower = (weather ?? "").toLowerCase();
  const range = weather?.match(/(-?\d+)\s*[-–—]\s*(-?\d+)\s*°?\s*C/i);
  const single = weather?.match(/(-?\d+)\s*°\s*C/i);
  const temp = range ? `${range[1]}–${range[2]}°C` : single ? `${single[1]}°C` : null;

  if (/rain|shower|storm|wet/.test(lower)) return { Icon: RainIcon, temp, label: "Rain likely" };
  if (/snow|sleet/.test(lower)) return { Icon: CloudIcon, temp, label: "Snow" };
  if (/cloud|overcast/.test(lower)) return { Icon: CloudIcon, temp, label: "Cloudy" };
  const word = TEMP_WORDS.find((w) => lower.includes(w));
  return { Icon: SunIcon, temp, label: word ? word[0].toUpperCase() + word.slice(1) : "Clear" };
}

function WeatherBadge({ weather }: { weather: string }) {
  const { Icon, temp, label } = weatherSummary(weather);
  return (
    <span
      title={weather}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-tag-neutral-bg/60 px-2.5 py-1 text-xs"
    >
      <Icon className="h-4 w-4 shrink-0 text-accent" />
      {temp && <span className="font-medium tabular-nums text-tag-neutral-fg">{temp}</span>}
      <span className="text-tag-neutral-fg/70">{label}</span>
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

function CategoryTile({ category }: { category: StopCategory }) {
  const Icon = CATEGORY_ICON[category ?? "other"];
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tag-neutral-bg text-accent">
      <Icon className="h-4 w-4" />
    </div>
  );
}

function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
    return <img src={photo} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return <CategoryTile category={category} />;
}

function StackedPhoto({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
    return <img src={photo} alt="" className="h-24 w-full rounded-xl object-cover shadow-sm" />;
  }
  const Icon = CATEGORY_ICON[category ?? "other"];
  return (
    <div className="flex h-24 w-full items-center justify-center rounded-xl bg-tag-neutral-bg text-accent">
      <Icon className="h-6 w-6" />
    </div>
  );
}

function StopRow({
  stop,
  index,
  isLast,
  onSelect,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  onSelect: (stop: Stop) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: index * 0.08 }}
      className="relative flex gap-3 rounded-xl transition-colors hover:bg-white/5"
    >
      {!isLast && (
        /* Spans avatar-bottom to next-avatar-top, so it has to stop short of this row's own
           height rather than exceed it: it starts at 2.75rem (top-11, a hair under the 2.5rem
           h-10 avatar) and the next avatar begins at 100% + 1rem (the parent's space-y-4), so
           the height is 100% + 1rem - 2.75rem. The old +0.5rem overshot by 2.25rem and drew
           straight through the following stop's avatar and name. Update this if the avatar
           size or the list gap changes. */
        <div className="absolute top-11 left-5 h-[calc(100%-1.75rem)] w-px bg-card-border" />
      )}
      <button
        type="button"
        onClick={() => onSelect(stop)}
        className="relative z-10 flex flex-1 gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span className="shrink-0">
          <StopAvatar name={stop.name} category={stop.category} />
        </span>
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
  editable,
  onLodgingActualCostChange,
}: {
  itinerary: Itinerary;
  budget: number;
  destination: string;
  onSelectStop: (stop: Stop) => void;
  editable?: boolean;
  onLodgingActualCostChange?: (dayIndex: number, value: number | undefined) => void;
}) {
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const headerPhoto = usePlacePhoto(destination, "full");
  const dayIndex = Math.min(activeDayIndex, itinerary.days.length - 1);
  const day = itinerary.days[dayIndex];
  const { showDayRoute } = useMapCamera();
  const dayTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Glowing pins + connecting arc for whichever day is active, redrawn on every day-tab switch.
  useEffect(() => {
    if (!day) return;
    showDayRoute(day.stops.map((s) => ({ lat: s.lat, lng: s.lng })));
  }, [day, showDayRoute]);

  // Keep the active day tab centered in its scroll row, including when the arrows below move it.
  useEffect(() => {
    dayTabRefs.current[dayIndex]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [dayIndex]);

  if (!day) return null;
  const breakdown = dayBreakdown(day);
  const photoStops = day.stops.slice(0, 3);
  const tierDescription = TIERS.find((t) => t.id === itinerary.tier)?.description ?? "";

  return (
    <div className="itinerary-glass overflow-hidden">
      <div
        className="relative flex min-h-[9rem] flex-col justify-end overflow-hidden p-5 text-on-deep sm:min-h-[11rem] sm:p-6"
        style={{ backgroundColor: "var(--surface-deep)" }}
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

      <div className="flex items-center gap-2 px-5 pb-3 sm:px-6">
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Day {dayIndex + 1} · {shortDate(day.date)}
          </h3>
          {day.weather && <WeatherBadge weather={day.weather} />}
        </div>

        {day.summary && <p className="mb-3 text-sm italic text-muted">{day.summary}</p>}

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

        {/* Photo column sits beside the stop list only, so it starts level with the first stop
            rather than alongside the lodging row above it. */}
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <div className="space-y-4">
              {day.stops.map((stop, i) => (
                <StopRow
                  key={i}
                  stop={stop}
                  index={i}
                  isLast={i === day.stops.length - 1}
                  onSelect={onSelectStop}
                />
              ))}
            </div>
          </div>

          <div className="hidden w-28 shrink-0 flex-col gap-2 lg:flex">
            {photoStops.map((stop, i) => (
              <StackedPhoto key={i} name={stop.name} category={stop.category} />
            ))}
          </div>
        </div>
      </div>

      <div
        className={`relative overflow-hidden border-t border-card-border p-5 sm:p-6 ${
          headerPhoto ? "" : "bg-tag-neutral-bg/30"
        }`}
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
                  <div className="font-semibold tabular-nums">${tile.amount}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
