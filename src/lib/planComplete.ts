import { parseJsonResponse } from "./claude";
import {
  MAX_STOPS_PER_DAY,
  realDate,
  type CompletePlanRequest,
  type ImportedDay,
  type ImportedPlan,
  type ImportedStop,
} from "./importedPlan";
import { formatClock, parseClock } from "./itinerary";
import { rescheduleDay, travellerTimes } from "./schedule";
import { MAX_TRIP_DAYS, closestTier } from "./tiers";
import type { DayPlan, ImportNote, Itinerary, Stop, StopCategory } from "./types";
import type { DayWeather } from "./weather";

/**
 * Bring your own itinerary, step two, as pure functions: validate what came back from the
 * confirm screen, give every day a date, ask for only what no data source has, and assemble an
 * ordinary `Itinerary`. The route around these does the fetching and the saving.
 */

export type DatedDay = { date: string; day: ImportedDay };

const TOO_LONG = "Trips over 30 days aren't supported — please choose a shorter date range.";
const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
const trimmed = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The trust boundary: everything from the client is re-read, never passed through. */
export function readCompleteRequest(body: unknown): CompletePlanRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const destination = trimmed(b.destination);
  if (!destination) return "Add where this trip is.";
  const p = (b.plan ?? {}) as Record<string, unknown>;
  const rawDays = Array.isArray(p.days) ? p.days : [];
  if (rawDays.length === 0) return "There's no plan to build.";
  if (rawDays.length > MAX_TRIP_DAYS) return TOO_LONG;

  const days: ImportedDay[] = rawDays.map((raw) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    const stops = (Array.isArray(d.stops) ? d.stops : [])
      .slice(0, MAX_STOPS_PER_DAY)
      .flatMap((rawStop): ImportedStop[] => {
        const s = (rawStop ?? {}) as Record<string, unknown>;
        const name = trimmed(s.name);
        if (!name) return [];
        const minutes = typeof s.time === "string" ? parseClock(s.time) : null;
        const note = trimmed(s.note);
        const lat = s.lat;
        const lng = s.lng;
        const placed =
          typeof lat === "number" && typeof lng === "number" &&
          Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        return [{
          name,
          ...(minutes === null ? {} : { time: formatClock(minutes) }),
          ...(note ? { note } : {}),
          ...(placed ? { lat, lng } : {}),
        }];
      });
    const date = realDate(d.date);
    const lodging = trimmed(d.lodging);
    return { stops, ...(date ? { date } : {}), ...(lodging ? { lodging } : {}) };
  });

  const startDate = realDate(b.startDate);
  const budget = typeof b.budget === "number" && Number.isFinite(b.budget) && b.budget > 0 ? b.budget : undefined;
  const plan: ImportedPlan = { destinationGuess: null, isPlan: true, days, loose: [], notes: [], unread: [] };
  return { plan, destination, ...(startDate ? { startDate } : {}), ...(budget ? { budget } : {}) };
}

/**
 * A date for every day, consecutive, because the trip routes derive the end date as
 * `tripEndDate(start, days.length)`. Real dates count only when every day has one: a skipped date
 * becomes an empty day and a repeated one merges in reading order. Otherwise the days count
 * forward from `startDate`, and without one there is nothing to count from.
 */
export function datesFor(days: ImportedDay[], startDate?: string): DatedDay[] | null {
  if (days.length > 0 && days.every((d) => d.date)) {
    const byDate = new Map<string, ImportedDay>();
    for (const d of days) {
      const prev = byDate.get(d.date!);
      byDate.set(d.date!, prev ? { ...prev, stops: [...prev.stops, ...d.stops], lodging: prev.lodging ?? d.lodging } : d);
    }
    const sorted = [...byDate.keys()].sort();
    const count = Math.round((utc(sorted[sorted.length - 1]) - utc(sorted[0])) / DAY_MS) + 1;
    return Array.from({ length: count }, (_, i) => {
      const date = addDays(sorted[0], i);
      return { date, day: byDate.get(date) ?? { stops: [] } };
    });
  }
  if (!startDate) return null;
  return days.map((day, i) => ({ date: addDays(startDate, i), day }));
}

export const stopId = (dayIndex: number, stopIndex: number) => `d${dayIndex}s${stopIndex}`;

export function buildFillPrompt(destination: string, dated: DatedDay[]): string {
  const lines = dated.flatMap(({ date, day }, d) => day.stops.map((s, i) => `${stopId(d, i)} — ${s.name} (${date})`));
  return `These are the stops of a traveller's own plan for a trip to ${destination}. Do not add, remove, rename or reorder anything: answer for exactly these ids.

For each stop id, estimate for one visitor:
- "cost": typical cost in USD, a number; 0 if free
- "durationMinutes": how long a visitor typically spends there, a whole number of minutes
- "category": one of "food", "entry", "transit", "other"
- "why": one short sentence on what the place is
- "note": one short practical sentence (best time to go, booking, what to know)
- "outdoor": true if weather could spoil it, false if it's indoors, null if unsure

${lines.join("\n")}

Respond with ONLY valid JSON, no code fences, in exactly this shape:
{"stops":{"d0s0":{"cost":10,"durationMinutes":60,"category":"entry","why":"…","note":"…","outdoor":true}}}`;
}

export interface FillEntry {
  cost: number;
  durationMinutes: number;
  category: StopCategory;
  why: string;
  note: string;
  outdoor: boolean | null;
}

const CATEGORIES: ReadonlySet<string> = new Set(["food", "entry", "transit", "other"]);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The fill, refused whole unless its ids are exactly the traveller's. This is what makes
 * "TripMate never adds or removes a stop" true in code rather than only requested.
 */
export function parseFill(raw: string, expectedIds: string[]): Record<string, FillEntry> | null {
  let parsed: { stops?: unknown };
  try {
    parsed = parseJsonResponse(raw);
  } catch {
    return null;
  }
  const stops = parsed?.stops;
  if (!stops || typeof stops !== "object" || Array.isArray(stops)) return null;
  const got = Object.keys(stops);
  if (got.length !== expectedIds.length || !expectedIds.every((id) => got.includes(id))) return null;

  const out: Record<string, FillEntry> = {};
  for (const id of expectedIds) {
    const s = (stops as Record<string, Record<string, unknown> | undefined>)[id];
    if (!s || typeof s !== "object" || !CATEGORIES.has(s.category as string)) return null;
    const cost = Number(s.cost);
    const minutes = Number(s.durationMinutes);
    out[id] = {
      cost: Number.isFinite(cost) ? clamp(Math.round(cost), 0, 2000) : 0,
      durationMinutes: Number.isFinite(minutes) ? clamp(Math.round(minutes / 15) * 15, 15, 8 * 60) : 90,
      category: s.category as StopCategory,
      why: typeof s.why === "string" ? s.why.trim() : "",
      note: typeof s.note === "string" ? s.note.trim() : "",
      outdoor: typeof s.outdoor === "boolean" ? s.outdoor : null,
    };
  }
  return out;
}

/** What a stop gets when the fill could not be had. */
export const defaultFill = (): FillEntry => ({
  cost: 0,
  durationMinutes: 90,
  category: "other",
  why: "",
  note: "",
  outdoor: null,
});

/** One unit only: `parseDuration` reads the first number it meets, so "1h 30m" would read as 60. */
export const durationLabel = (minutes: number) =>
  minutes >= 60 && minutes % 30 === 0 ? `${minutes / 60} h` : `${minutes} min`;

export function centreOf(stops: ImportedStop[]): { lat: number; lng: number } | null {
  const found = stops.filter((s) => typeof s.lat === "number" && typeof s.lng === "number");
  if (found.length === 0) return null;
  return {
    lat: found.reduce((t, s) => t + (s.lat as number), 0) / found.length,
    lng: found.reduce((t, s) => t + (s.lng as number), 0) / found.length,
  };
}

/** Where a stop nobody could find is drawn when its own day has no found stops either. */
export function fallbackPoint(
  geo: { lat: number; lon: number } | null,
  stops: ImportedStop[]
): { lat: number; lng: number } | null {
  return geo ? { lat: geo.lat, lng: geo.lon } : centreOf(stops);
}

/** A real budget against zeroed costs would read as comfortably under it, so a failed fill stores none. */
export const budgetToStore = (budget: number | undefined, filled: boolean) => (filled && budget ? budget : 0);

export interface AssembleInput {
  dated: DatedDay[];
  fill: Record<string, FillEntry> | null;
  /** Closed weekdays by stop name; null when the hours lookup failed or never ran. */
  hours: Record<string, string[] | null> | null;
  weather: DayWeather[];
  budget: number;
  fallback: { lat: number; lng: number };
}

export function assembleItinerary(input: AssembleInput): Itinerary {
  const weatherByDate = new Map(input.weather.map((w) => [w.date, w]));
  const keepTimeOf = travellerTimes({ origin: "imported" });

  const days: DayPlan[] = input.dated.map(({ date, day }, d) => {
    const centre = centreOf(day.stops) ?? input.fallback;
    const stops = day.stops.map((s, i): Stop => {
      const filled = input.fill?.[stopId(d, i)];
      const e = filled ?? defaultFill();
      const found = typeof s.lat === "number" && typeof s.lng === "number";
      const estimated: ("time" | "cost" | "duration")[] = [
        ...(s.time ? [] : ["time" as const]),
        "duration",
        ...(filled ? ["cost" as const] : []),
      ];
      return {
        name: s.name,
        lat: found ? (s.lat as number) : centre.lat,
        lng: found ? (s.lng as number) : centre.lng,
        located: found ? "osm" : "model",
        cost: e.cost,
        note: s.note ?? e.note,
        ...(e.why ? { why: e.why } : {}),
        time: s.time ?? "",
        durationLabel: durationLabel(e.durationMinutes),
        category: e.category,
        ...(e.outdoor === null ? {} : { outdoor: e.outdoor }),
        estimated,
        ...(input.hours === null ? {} : { closedDays: input.hours[s.name] ?? null }),
      };
    });
    const weatherDetail = weatherByDate.get(date);
    const planned: DayPlan = {
      date,
      // The model's prose field. Left empty rather than invented; the badge reads weatherDetail.
      weather: "",
      ...(weatherDetail ? { weatherDetail } : {}),
      ...(day.lodging ? { lodging: { name: day.lodging, cost: 0, note: "" } } : {}),
      stops,
    };
    return rescheduleDay(planned, { keepTimeOf });
  });

  const importNotes: ImportNote[] = [
    ...(input.hours === null ? ["hoursUnchecked" as const] : []),
    ...(input.fill === null ? ["costsUnestimated" as const] : []),
  ];
  return {
    tier: input.budget > 0 ? closestTier(input.budget, days.length) : "midrange",
    days,
    origin: "imported",
    ...(importNotes.length ? { importNotes } : {}),
  };
}
