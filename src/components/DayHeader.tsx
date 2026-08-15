"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, X } from "lucide-react";
import { DayPlan } from "@/lib/types";
import { formatItineraryDate } from "@/lib/itinerary";
import { CloudIcon, RainIcon, SunIcon } from "./icons";
import { devLabel } from "@/lib/devInspector";

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

export interface DayEditUpdates {
  title?: string;
  date?: string;
}

function DayEditForm({
  day,
  onSave,
  onCancel,
}: {
  day: DayPlan;
  onSave: (updates: DayEditUpdates) => void;
  onCancel: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const fieldClass =
    "rounded-md border border-card-border bg-white/10 px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/25";

  function handleSave() {
    onSave({
      title: titleRef.current?.value.trim() || undefined,
      date: dateRef.current?.value || day.date,
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Title
        <input ref={titleRef} type="text" defaultValue={day.title ?? ""} placeholder="Add a title…" className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Date
        <input ref={dateRef} type="date" defaultValue={day.date} className={fieldClass} />
      </label>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        title="Cancel"
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleSave}
        aria-label="Save day"
        title="Save"
        className="rounded-md bg-accent p-1.5 text-accent-foreground transition-opacity hover:opacity-90"
      >
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function DayHeader({
  day,
  dayIndex,
  animateReveal,
  editable,
  onEditDay,
}: {
  day: DayPlan;
  dayIndex: number;
  /** Skips the entrance animation entirely when false/undefined — only true on
   *  ItineraryCard's first mount right after generation, since a day-tab
   *  switch re-renders this element rather than remounting it. */
  animateReveal?: boolean;
  editable?: boolean;
  onEditDay?: (dayIndex: number, updates: DayEditUpdates) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <DayEditForm
        day={day}
        onSave={(updates) => {
          onEditDay?.(dayIndex, updates);
          setIsEditing(false);
        }}
        onCancel={() => setIsEditing(false)}
      />
    );
  }

  return (
    <motion.div
      initial={animateReveal ? { opacity: 0, y: -12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mb-3 flex flex-wrap items-center justify-between gap-2"
      {...devLabel("ItineraryCard.DayHeader")}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Day {dayIndex + 1}
          {day.title ? ` — ${day.title}` : ""} · {formatItineraryDate(day.date)}
        </h3>
        {editable && onEditDay && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            aria-label="Edit day"
            title="Edit day"
            className="rounded-md p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {day.weather && <WeatherBadge weather={day.weather} />}
    </motion.div>
  );
}
