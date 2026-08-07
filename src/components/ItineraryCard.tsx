"use client";

import { useState } from "react";
import { DayPlan, Itinerary, Stop, StopCategory } from "@/lib/types";
import { usePlacePhoto } from "@/lib/usePlacePhoto";
import { TIERS } from "@/lib/tiers";
import BudgetBar from "./BudgetBar";
import { EntryIcon, FoodIcon, LodgingIcon, PinIcon, TransitIcon } from "./icons";

const CATEGORY_ICON: Record<StopCategory, typeof FoodIcon> = {
  food: FoodIcon,
  entry: EntryIcon,
  transit: TransitIcon,
  other: PinIcon,
};

function tagStyle(tag: string): string {
  const lower = tag.toLowerCase();
  if (lower.includes("ai")) return "bg-tag-highlight-bg text-tag-highlight-fg";
  if (lower.includes("local") || lower.includes("free") || lower.includes("recommend") || lower.includes("must"))
    return "bg-tag-positive-bg text-tag-positive-fg";
  return "bg-tag-neutral-bg text-tag-neutral-fg";
}

function dayBreakdown(day: DayPlan) {
  const sums: Record<StopCategory, number> = { food: 0, entry: 0, transit: 0, other: 0 };
  for (const stop of day.stops) sums[stop.category] += stop.cost;
  const stay = day.lodging?.cost ?? 0;
  const total = sums.food + sums.entry + sums.transit + sums.other + stay;
  return [
    { label: "Food", amount: sums.food, Icon: FoodIcon },
    { label: "Entry", amount: sums.entry, Icon: EntryIcon },
    { label: "Transit", amount: sums.transit, Icon: TransitIcon },
    { label: "Stay", amount: stay, Icon: LodgingIcon },
    { label: "Total", amount: total, Icon: PinIcon },
  ];
}

function StopAvatar({ name, category }: { name: string; category: StopCategory }) {
  const photo = usePlacePhoto(name);
  const Icon = CATEGORY_ICON[category];
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external Wikipedia thumbnails, small/lazy, not worth next/image config
    return <img src={photo} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tag-neutral-bg text-accent">
      <Icon className="h-4 w-4" />
    </div>
  );
}

function StackedPhoto({ name }: { name: string }) {
  const photo = usePlacePhoto(name);
  if (!photo) return null;
  // eslint-disable-next-line @next/next/no-img-element -- see StopAvatar
  return <img src={photo} alt="" className="h-24 w-full rounded-xl object-cover shadow-sm" />;
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
  const headerPhoto = usePlacePhoto(destination);
  const dayIndex = Math.min(activeDayIndex, itinerary.days.length - 1);
  const day = itinerary.days[dayIndex];
  const breakdown = dayBreakdown(day);
  const photoStops = day.stops.slice(0, 3);
  const tierDescription = TIERS.find((t) => t.id === itinerary.tier)?.description ?? "";

  return (
    <div className="card overflow-hidden rounded-2xl">
      <div
        className="relative flex flex-col justify-end gap-1 p-5 text-accent-foreground sm:p-6"
        style={{
          backgroundColor: "var(--accent)",
          backgroundImage: headerPhoto
            ? `linear-gradient(rgba(31,58,52,0.75), rgba(31,58,52,0.85)), url(${headerPhoto})`
            : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <h2 className="font-display text-2xl font-semibold">
          {destination}: {itinerary.days.length} Day{itinerary.days.length > 1 ? "s" : ""}
        </h2>
        <p className="text-sm opacity-90">
          {tierDescription} · ${budget} budget
        </p>
      </div>

      <div className="p-5 sm:p-6">
        <BudgetBar days={itinerary.days} budget={budget} />
      </div>

      <div className="flex gap-2 overflow-x-auto px-5 pb-3 sm:px-6">
        {itinerary.days.map((d, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveDayIndex(i)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              i === dayIndex
                ? "bg-accent text-accent-foreground"
                : "border border-card-border text-foreground/70 hover:bg-tag-neutral-bg"
            }`}
          >
            Day {i + 1}
          </button>
        ))}
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Day {dayIndex + 1} · {day.date}
          </h3>
          <span className="text-sm text-muted">{day.weather}</span>
        </div>

        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
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
            <div className="space-y-4">
              {day.stops.map((stop, i) => (
                <div key={i} className="relative flex gap-3">
                  {i < day.stops.length - 1 && (
                    <div className="absolute top-11 left-5 h-[calc(100%+0.5rem)] w-px bg-card-border" />
                  )}
                  <button
                    type="button"
                    onClick={() => onSelectStop(stop)}
                    className="relative z-10 shrink-0"
                  >
                    <StopAvatar name={stop.name} category={stop.category} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectStop(stop)}
                    className="flex-1 text-left"
                  >
                    <div className="font-medium text-foreground">{stop.name}</div>
                    <div className="text-sm text-muted">
                      {stop.time} · {stop.durationLabel}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {stop.tags.map((tag, ti) => (
                        <span
                          key={ti}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${tagStyle(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden w-28 shrink-0 flex-col gap-2 lg:flex">
            {photoStops.map((stop, i) => (
              <StackedPhoto key={i} name={stop.name} />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-card-border bg-tag-neutral-bg/30 p-5 sm:p-6">
        <div className="mb-3 text-sm font-semibold text-foreground">
          Day {dayIndex + 1} — Budget Breakdown
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {breakdown.map((tile) => (
            <div key={tile.label} className="rounded-xl bg-tile p-3 text-tile-foreground">
              <tile.Icon className="h-4 w-4" />
              <div className="mt-1 text-xs opacity-90">{tile.label}</div>
              <div className="font-semibold tabular-nums">${tile.amount}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
