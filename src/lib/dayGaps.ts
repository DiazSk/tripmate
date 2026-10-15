// Relative imports only: this module is reached from a `.test.mjs`, and `scripts/ts-resolve.mjs`
// retries relative specifiers alone.
import { DEFAULT_VISIT_MIN, formatClock, parseDurationLabel } from "./daySlotting";
import { parseClockTime } from "./timeOfDay";
import { closedDaysFromOpeningHours } from "./openingDays";
import { isClosedOn, weekdayName } from "./guardrails";
import { newStop, stopCategoryFor } from "./itineraryEdits";
import type { Itinerary, Stop } from "./types";

/**
 * The holes in a day, and whether a place found on the map fits one of them: what the trip page's
 * map search ("Spotlight with the day") is built on.
 *
 * Most of the time somebody searches the map from a trip, they are looking for something to put in
 * a gap: an hour between the castle and lunch, the evening after the last stop. So the gaps are a
 * first-class part of the search, and a place is offered with the time it would start already
 * worked out, on foot, from the stop before it.
 *
 * **Hours are checked by the day, not by the clock.** OSM's `opening_hours` is a grammar, and the
 * search panel already refuses to evaluate it into "open now" (see `FoundPlace.openingHours`): a
 * wrong answer tells somebody a closed door is open. `closedDaysFromOpeningHours` is the part that
 * is safe, a place closed on the gap's weekday, and the rest is shown as written for the traveller
 * to read.
 */

/** The day the gaps are looked for in: from 9 AM to 10 PM, the waking hours of a travel day. */
export const DAY_START_MIN = 9 * 60;
export const DAY_END_MIN = 22 * 60;
/** A gap shorter than this is a breath between two stops, not room for a third. */
export const MIN_GAP_MIN = 40;
/** The furthest a gap's stop will reach for it on foot. */
export const REACH_WALK_MIN = 15;

/** Walking, as `travelTime.ts` prices it: 4.5 km/h over streets that run 1.3 times the straight line. */
const WALK_KMH = 4.5;
const CIRCUITY = 1.3;

/** How long a visit of each kind is planned for, by the search's own categories. */
export const VISIT_MIN: Record<string, number> = {
  cafe: 30,
  restaurant: 75,
  bar: 60,
  sights: 60,
  park: 40,
  shop: 30,
  hotel: 20,
  place: 45,
};

export interface DayGap {
  /** Minutes since midnight. */
  start: number;
  end: number;
  /** The stops either side, by index into the day's stops: the one it follows and the one it ends at. */
  before: number | null;
  after: number | null;
}

/**
 * The gaps of at least `MIN_GAP_MIN` between a day's timed stops, 9 AM to 10 PM. A stop with no
 * time cannot bound a gap and is ignored; one with no duration is held for `DEFAULT_VISIT_MIN`, the
 * same assumption `planSlot` makes.
 */
export function gapsOfDay(stops: Stop[]): DayGap[] {
  const timed = stops
    .map((stop, index) => ({ index, start: parseClockTime(stop.time) }))
    .filter((s): s is { index: number; start: number } => s.start !== null)
    .sort((a, b) => a.start - b.start);
  const out: DayGap[] = [];
  let cursor = DAY_START_MIN;
  let before: number | null = null;
  for (const s of timed) {
    if (s.start - cursor >= MIN_GAP_MIN) out.push({ start: cursor, end: Math.min(s.start, DAY_END_MIN), before, after: s.index });
    const length = parseDurationLabel(stops[s.index].durationLabel) ?? DEFAULT_VISIT_MIN;
    cursor = Math.max(cursor, s.start + length);
    before = s.index;
  }
  if (DAY_END_MIN - cursor >= MIN_GAP_MIN) out.push({ start: cursor, end: DAY_END_MIN, before, after: null });
  return out.filter((g) => g.end - g.start >= MIN_GAP_MIN);
}

/** Minutes on foot between two points, never less than one. */
export function walkMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  const km = 6371 * 2 * Math.asin(Math.sqrt(h)) * CIRCUITY;
  return Math.max(1, Math.round((km / WALK_KMH) * 60));
}

export interface FitPlace {
  lat: number;
  lng: number;
  category?: string;
  openingHours?: string;
}

export type GapFit =
  | { ok: true; start: number; end: number; walkFrom: number; gap: DayGap }
  | { ok: false; why: string };

/**
 * Whether a place fits a gap, and at what time: walked to from the stop before the gap (or towards
 * the one after it, when the gap opens the day), held for its kind's visit, and walked on from to
 * the next stop in time. `date` is the day's ISO date, for the closed-day check.
 */
export function fitInGap(place: FitPlace, gap: DayGap, stops: Stop[], date: string): GapFit {
  const anchorIndex = gap.before ?? gap.after;
  const anchor = anchorIndex === null ? null : stops[anchorIndex];
  if (!anchor) return { ok: false, why: "Nothing in the day to walk from" };
  const walkFrom = walkMinutes(anchor, place);
  if (walkFrom > REACH_WALK_MIN) return { ok: false, why: `${walkFrom} min walk from ${anchor.name}` };
  const closedDays = closedDaysFromOpeningHours(place.openingHours ?? null) ?? undefined;
  if (date && isClosedOn({ closedDays }, date)) return { ok: false, why: `Closed on ${weekdayName(date)}` };
  const next = gap.after === null ? null : stops[gap.after];
  const walkOn = next && gap.before !== null ? walkMinutes(place, next) : 0;
  const visit = VISIT_MIN[place.category ?? "place"] ?? VISIT_MIN.place;
  const start = Math.ceil((gap.start + (gap.before !== null ? walkFrom : 0)) / 5) * 5;
  const end = start + visit;
  if (end + walkOn > gap.end) return { ok: false, why: `Needs ${spanLabel(visit + walkFrom + walkOn)}, the gap is ${spanLabel(gap.end - gap.start)}` };
  return { ok: true, start, end, walkFrom, gap };
}

/** The first gap of the day a place fits, or null. */
export function bestGap(place: FitPlace, gaps: DayGap[], stops: Stop[], date: string): Extract<GapFit, { ok: true }> | null {
  for (const gap of gaps) {
    const fit = fitInGap(place, gap, stops, date);
    if (fit.ok) return fit;
  }
  return null;
}

/** What suits a gap by when it falls: coffee and sights in the morning, sights and coffee in the
 *  afternoon, dinner and a drink in the evening. A suggestion, not a filter. */
export function suitsGap(gap: DayGap): string[] {
  const middle = (gap.start + gap.end) / 2;
  if (middle < 12 * 60) return ["cafe", "sights"];
  if (middle < 17.5 * 60) return ["sights", "cafe"];
  return ["restaurant", "bar"];
}

/** "1h 30m", "45m". */
export function spanLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

/**
 * Put a found place into a day at an exact time: the start its gap fit worked out. Nothing already
 * in the plan moves; the stop lands among the timed stops where its time puts it. No
 * `durationLabel`, for `addPlaceToDay`'s reason: the visit length spaced the fit, and how long
 * somebody wants to stay is not something a search result knows.
 */
export function addPlaceAt(itinerary: Itinerary, dayIndex: number, place: { name: string; lat: number; lng: number; category?: string }, minutes: number): Itinerary {
  const day = itinerary.days[dayIndex];
  if (!day) return itinerary;
  const stop: Stop = {
    ...newStop(place.name, place.lat, place.lng),
    category: stopCategoryFor(place.category),
    time: formatClock(minutes),
  };
  const at = day.stops.findIndex((s) => {
    const t = parseClockTime(s.time);
    return t !== null && t > minutes;
  });
  const stops = [...day.stops];
  stops.splice(at === -1 ? stops.length : at, 0, stop);
  return { ...itinerary, days: itinerary.days.map((d, i) => (i === dayIndex ? { ...d, stops } : d)) };
}
