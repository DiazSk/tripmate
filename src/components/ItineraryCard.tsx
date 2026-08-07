"use client";

import { useState } from "react";
import { DayPlan, Itinerary, Stop, StopCategory } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import BudgetBar from "./BudgetBar";
import {
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
      {temp && <span className="font-medium tabular-nums text-foreground">{temp}</span>}
      <span className="text-muted">{label}</span>
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
    // eslint-disable-next-line @next/next/no-img-element -- see StopAvatar
    return <img src={photo} alt="" className="h-24 w-full rounded-xl object-cover shadow-sm" />;
  }
  const Icon = CATEGORY_ICON[category ?? "other"];
  return (
    <div className="flex h-24 w-full items-center justify-center rounded-xl bg-tag-neutral-bg text-accent">
      <Icon className="h-6 w-6" />
    </div>
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
  if (!day) return null;
  const breakdown = dayBreakdown(day);
  const photoStops = day.stops.slice(0, 3);
  const tierDescription = TIERS.find((t) => t.id === itinerary.tier)?.description ?? "";

  return (
    <div className="card overflow-hidden rounded-2xl">
      <div
        className="relative flex min-h-[9rem] flex-col justify-end overflow-hidden p-5 text-accent-foreground sm:min-h-[11rem] sm:p-6"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {headerPhoto && (
          <BlurredPhotoLayer
            photo={headerPhoto}
            tint="linear-gradient(rgba(31,58,52,0.35), rgba(31,58,52,0.88))"
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

      <div className="flex gap-1.5 overflow-x-auto px-5 pb-3 sm:px-6">
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
              type="button"
              onClick={() => setActiveDayIndex(i)}
              style={{ clipPath }}
              className={`shrink-0 py-2 pr-7 text-sm font-medium transition-colors ${
                isFirst ? "pl-5" : "pl-7"
              } ${
                i === dayIndex
                  ? "bg-accent text-accent-foreground"
                  : "bg-tag-neutral-bg/70 text-foreground/70 hover:bg-tag-neutral-bg"
              }`}
            >
              Day {i + 1}
            </button>
          );
        })}
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
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-tag-neutral-bg/50 p-3">
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
                  className="w-20 rounded-md border border-card-border bg-white px-2 py-1 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25"
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
                <div key={i} className="relative flex gap-3">
                  {i < day.stops.length - 1 && (
                    <div className="absolute top-11 left-5 h-[calc(100%+0.5rem)] w-px bg-card-border" />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectStop(stop)}
                    className="relative z-10 flex flex-1 gap-3 text-left"
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
                </div>
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
            tint="linear-gradient(rgba(31,58,52,0.55), rgba(31,58,52,0.8))"
          />
        )}
        <div className="relative z-10">
          <div
            className={`mb-3 text-sm font-semibold ${headerPhoto ? "text-accent-foreground" : "text-foreground"}`}
          >
            Day {dayIndex + 1} — Budget Breakdown
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {breakdown.map((tile) => {
              const isTotal = tile.label === "Total";
              // Frosted glass reads only over the photo band; without a photo the footer is pale
              // tan, where translucent tiles would leave the labels unreadable — so that case
              // keeps the solid terracotta fills. The glass is black-tinted rather than white:
              // a bright photo behind a white-tinted tile drops the label to ~2.5:1, while
              // darkening holds >4.5:1 whatever the photo happens to be.
              const surface = headerPhoto
                ? `border text-accent-foreground backdrop-blur-md ${
                    isTotal ? "border-white/40 bg-black/40" : "border-white/20 bg-black/25"
                  }`
                : isTotal
                  ? "bg-accent text-accent-foreground"
                  : "bg-tile text-tile-foreground";
              return (
                <div key={tile.label} className={`rounded-xl p-3 ${surface}`}>
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
