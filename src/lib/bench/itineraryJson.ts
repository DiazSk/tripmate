import { knownPois } from "./fixtures";
import { SLOTS, formatClock, parseItinerary } from "./parseItinerary";
import { findPoi } from "./scorers/domain";
import type { BenchFixture } from "./fixtures";
import type { Slot } from "./parseItinerary";
import type { StopCategory } from "../types";

/**
 * Turns the model's markdown into the structured, machine-readable half of the benchmark's output.
 *
 * The app has two generation paths (see CLAUDE.md): the legacy single-shot route emits strict JSON
 * `Itinerary` objects, and the staged Step-6 path this benchmark exercises emits markdown. So a
 * benchmark cell has a readable artifact but no structured one, and "show me the JSON" had no
 * answer. This module supplies it — deterministically, from the same parse the scorers use, so the
 * JSON view and every metric on the page describe the same reading of the output.
 *
 * It follows the app's own vocabulary where the markdown supports it: `StopCategory` is the app's
 * union, and each day carries the REAL forecast for its date pulled from the trip bundle rather
 * than the model's prose — the same "attach the fetched weather server-side, don't trust the
 * model's guess" rule `/api/itinerary` already applies via `weatherDetail`.
 *
 * Two fields the markdown genuinely cannot supply are omitted rather than faked: per-stop `cost`
 * (the staged path never asks for money) and `tier`. Emitting `cost: 0` would put a wrong number
 * into a machine-readable payload, which is worse than an absent one.
 */

export interface BenchStopJson {
  name: string;
  slot: Slot;
  /** "09:00-11:30" in 24h, normalized from whatever clock format the model wrote. */
  time: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  durationLabel: string | null;
  transportToNext: { mode: string; minutes: number | null } | null;
  /** True for §3b area-level entries (a district + a meal, not a specific venue). */
  areaLevel: boolean;
  category: StopCategory;
  /** Resolved from the trip's candidate/anchor set when the name matches one; null otherwise. */
  lat: number | null;
  lng: number | null;
  matchedPoi: string | null;
  /** The model's original bullet, kept so nothing is lost in translation. */
  raw: string;
}

export interface BenchDayJson {
  date: string | null;
  dayOfWeek: string | null;
  theme: string | null;
  /** The real fetched forecast for this date — not the model's prose. */
  weather: {
    tempMinC: number;
    tempMaxC: number;
    precipitationProbability: number | null;
    sunrise: string | null;
    sunset: string | null;
    estimated: boolean;
  } | null;
  stayNear: string | null;
  note: string | null;
  stops: BenchStopJson[];
}

export interface BenchItineraryJson {
  destination: string | null;
  tripDays: number;
  model: string;
  /** Any preamble the model wrote before day 1 (the skill allows an assumptions note). */
  preamble: string | null;
  days: BenchDayJson[];
  /** Stated plainly so a consumer doesn't read their absence as zero. */
  omittedFields: string[];
}

const FOOD_WORDS =
  /\b(breakfast|brunch|lunch|dinner|supper|coffee|tea|drinks|snack|meal|eat|dining|restaurant|market|izakaya|cafe|café|bar)\b/i;
const TRANSIT_WORDS = /\b(transfer|airport|station|check[- ]?in|check[- ]?out|train|flight|bus to)\b/i;

function categorize(name: string, raw: string, matched: boolean): StopCategory {
  if (TRANSIT_WORDS.test(name)) return "transit";
  if (FOOD_WORDS.test(name)) return "food";
  if (matched) return "entry";
  return raw.trim() ? "other" : "other";
}

export function toItineraryJson(
  markdown: string,
  fixture: BenchFixture,
  model: string
): BenchItineraryJson {
  const parsed = parseItinerary(markdown);
  const pois = knownPois(fixture);
  const forecast = fixture.reconciled.rawFetch.weather;
  const tripDays = fixture.reconciled.rawFetch.dateContext.days;

  const days: BenchDayJson[] = parsed.days.map((day, dayIndex) => {
    // Weather rows are 1:1 with trip days by position, not by their own `date` — the historical
    // fallback reports last year's calendar dates (see the note in tripContext.ts).
    const w = forecast.available ? forecast.days[dayIndex] : undefined;

    const stops: BenchStopJson[] = SLOTS.flatMap((slot) =>
      day.entriesBySlot[slot].map((entry) => {
        const poi = entry.areaLevel ? null : findPoi(entry.name, pois);
        return {
          name: entry.name,
          slot,
          time: entry.window
            ? `${formatClock(entry.window.startMin % (24 * 60))}-${formatClock(entry.window.endMin % (24 * 60))}`
            : null,
          startTime: entry.window ? formatClock(entry.window.startMin % (24 * 60)) : null,
          endTime: entry.window ? formatClock(entry.window.endMin % (24 * 60)) : null,
          durationMinutes: entry.durationMin,
          durationLabel:
            entry.durationMin === null
              ? null
              : entry.durationMin >= 60
                ? `${Math.round((entry.durationMin / 60) * 10) / 10}h`
                : `${entry.durationMin} min`,
          transportToNext: entry.transport
            ? { mode: entry.transport.mode, minutes: entry.transport.minutes }
            : null,
          areaLevel: entry.areaLevel,
          category: categorize(entry.name, entry.raw, poi !== null),
          lat: poi?.lat ?? null,
          lng: poi?.lon ?? null,
          matchedPoi: poi?.name ?? null,
          raw: entry.raw,
        };
      })
    );

    return {
      date: day.date ?? tripDays[dayIndex]?.date ?? null,
      dayOfWeek: day.dayOfWeek ?? tripDays[dayIndex]?.dayOfWeek ?? null,
      theme: day.theme,
      weather: w
        ? {
            tempMinC: w.tempMinC,
            tempMaxC: w.tempMaxC,
            precipitationProbability: w.precipitationProbability,
            sunrise: w.sunrise?.split("T")[1]?.slice(0, 5) ?? null,
            sunset: w.sunset?.split("T")[1]?.slice(0, 5) ?? null,
            estimated: forecast.historical,
          }
        : null,
      stayNear: day.stayNear,
      note: day.note,
      stops,
    };
  });

  return {
    destination: fixture.reconciled.rawFetch.destination.region,
    tripDays: fixture.reconciled.rawFetch.dateContext.tripDays,
    model,
    preamble: parsed.preamble.trim() || null,
    days,
    omittedFields: [
      "stop.cost — the staged generation path never asks the model for prices",
      "tier — belongs to the legacy single-shot path, not this one",
    ],
  };
}

/** Total entries across the plan, for the UI's at-a-glance count. */
export function countStops(json: BenchItineraryJson): number {
  return json.days.reduce((sum, d) => sum + d.stops.length, 0);
}

/** Verify the parse round-trips: every day in the output is represented. */
export function dayCount(json: BenchItineraryJson): number {
  return json.days.length;
}
