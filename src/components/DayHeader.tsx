"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, X } from "lucide-react";
import { DayPlan } from "@/lib/types";
import { DayWeather } from "@/lib/weather";
import { formatItineraryDate } from "@/lib/itinerary";
import { CloudIcon, RainIcon, SunIcon } from "./icons";
import { devLabel } from "@/lib/devInspector";

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

/** WMO weather codes, as returned by Open-Meteo. Mapped onto the three weather icons the
 *  system draws — the point is the condition, not a taxonomy. */
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
 * Fallback for itineraries saved before `weatherDetail` existed: condense the model's free
 * text ("Warm (24-32°C) with high rain chance (63%)") to an icon and a temperature. It
 * deliberately returns a null label rather than guessing — "Windy and grey" used to come
 * back as a sun captioned "Clear".
 */
function readProse(weather: string): WeatherRead {
  const lower = (weather ?? "").toLowerCase();
  // The decimal part is not optional decoration: the model writes "13.6-21°C", and a `\d+`
  // that can't span the ".6" matched the *fragment* "6-21" and printed 6–21°C.
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

/** Everything the badge knows is printed in it. The rain chance and the typical-weather
 *  caveat used to live only in a `title` on a non-focusable span, which is to say nowhere
 *  for anyone on a keyboard or a phone. */
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
  isEditing: controlledEditing,
  onEditingChange,
  inlineEditing,
  onInlineEdit,
}: {
  day: DayPlan;
  dayIndex: number;
  /** Skips the entrance animation entirely when false/undefined — only true on
   *  ItineraryCard's first mount right after generation, since a day-tab
   *  switch re-renders this element rather than remounting it. */
  animateReveal?: boolean;
  editable?: boolean;
  onEditDay?: (dayIndex: number, updates: DayEditUpdates) => void;
  /** Edit mode, owned by the parent when supplied.
   *
   *  It is controlled because the same flag decides whether the card's stop list shows its drag
   *  handles — editing a day and rearranging it are one intent. Keeping a private copy here as
   *  well meant two sources of truth for one piece of state, and the handles could disagree with
   *  the form about whether the day was being edited. Falls back to local state when the parent
   *  doesn't care. */
  isEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /**
   * Inline edit mode — the card's whole day panel is editable and this header is part of it.
   *
   * Distinct from `isEditing` above, which swaps this header for `DayEditForm`: a labelled,
   * bordered, save/cancel form that is a different height and a different shape from the heading
   * it replaces. That is the right affordance for "edit just this day's title" reached from the
   * pencil, and the wrong one inside a mode whose entire premise is that nothing moves. Here the
   * heading keeps its own box, its own type and its own weather badge, and only the text becomes
   * typeable. Changes commit as they are typed — there is no local save, because the card's Done
   * is the save.
   */
  inlineEditing?: boolean;
  onInlineEdit?: (updates: DayEditUpdates) => void;
}) {
  const [localEditing, setLocalEditing] = useState(false);
  const isEditing = controlledEditing ?? localEditing;

  const setEditing = (editing: boolean) => {
    setLocalEditing(editing);
    onEditingChange?.(editing);
  };

  if (inlineEditing) {
    return (
      <div
        // The read-only heading's container, unchanged, so the weather badge stays exactly where
        // it was and the row keeps its height.
        className="mb-3 flex flex-wrap items-center justify-between gap-2"
        {...devLabel("ItineraryCard.DayHeader.Inline")}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-1.5 font-display text-lg font-semibold text-foreground">
          {/* "Day N" is not editable — it is the day's index, not a name, and typing over it
              would imply a reordering this control cannot perform. */}
          <span className="shrink-0">Day {dayIndex + 1}</span>
          <input
            value={day.title ?? ""}
            onChange={(e) => onInlineEdit?.({ title: e.target.value || undefined })}
            aria-label={`Day ${dayIndex + 1} title`}
            placeholder="Add a title…"
            // Inherits the heading's font, size and weight from the container — the whole point.
            // Borderless until touched, so a heading that can be edited still reads as a heading.
            className="min-w-24 flex-1 rounded-md border border-transparent bg-transparent px-1.5 transition-colors placeholder:font-normal placeholder:text-muted/60 hover:border-white/10 hover:bg-white/[0.07] focus:border-white/10 focus:bg-white/[0.07] focus:outline-none"
          />
          <span aria-hidden="true" className="shrink-0 text-muted">·</span>
          {/* A native date input, because the value is an ISO calendar date and hand-typing one
              is how a trip ends up with a day dated 2026-13-04. It carries the heading's own type
              rather than the form's `text-sm`, so the line does not change height. */}
          <input
            type="date"
            value={day.date}
            onChange={(e) => e.target.value && onInlineEdit?.({ date: e.target.value })}
            aria-label={`Day ${dayIndex + 1} date`}
            className="shrink-0 rounded-md border border-transparent bg-transparent px-1.5 font-display text-lg font-semibold text-foreground transition-colors hover:border-white/10 hover:bg-white/[0.07] focus:border-white/10 focus:bg-white/[0.07] focus:outline-none"
          />
        </div>
        <WeatherBadge day={day} />
      </div>
    );
  }

  if (isEditing) {
    return (
      <DayEditForm
        day={day}
        onSave={(updates) => {
          onEditDay?.(dayIndex, updates);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
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
            onClick={() => setEditing(true)}
            aria-label="Edit day"
            title="Edit this day and rearrange its stops"
            className="rounded-md p-1 text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <WeatherBadge day={day} />
    </motion.div>
  );
}
