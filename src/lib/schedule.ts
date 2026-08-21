import { formatClock, parseClock, parseDuration } from "./itinerary";
import { travelLegBetween } from "./travelTime";
import type { DayPlan, Itinerary, Stop, TransportMode } from "./types";

/**
 * Re-timing a day after it has been rearranged by hand.
 *
 * This is the whole reason drag-and-drop can be instant. Reordering stops invalidates every start
 * time after the first, and the honest answer to "when do I get there now?" is arithmetic —
 * duration plus the travel leg to the next place — not a judgement call. So none of this asks the
 * model anything: a drop recomputes locally in the same frame, and the LLM is left for the things
 * only it can do (which place to add, what to say about it). A model round trip here would cost
 * 70-140s and produce worse times than `travelLegBetween` already gives for free.
 *
 * Every function here is pure and returns new objects — the caller owns whether a change is
 * committed, exactly as the chat edit path does with its draft.
 */

/** Where a day starts when not one of its stops carries a readable time. */
const DEFAULT_DAY_START_MIN = 9 * 60;

/** Computed starts are rounded up to this granularity. Raw arithmetic produces "9:01 AM" and
 *  "10:33 AM", which read as a simulation rather than a plan a person would follow. Rounding UP is
 *  what makes it safe — it only ever adds slack to a leg, never borrows from one. */
const SLOT_MINUTES = 5;

const roundUpToSlot = (minutes: number) => Math.ceil(minutes / SLOT_MINUTES) * SLOT_MINUTES;

const stopPoint = (stop: Stop) => ({ lat: stop.lat, lon: stop.lng });

/** Travel minutes between two consecutive stops, from their coordinates. */
export function legMinutes(from: Stop, to: Stop, modes?: TransportMode[]): number {
  return travelLegBetween(stopPoint(from), stopPoint(to), modes).minutes;
}

export interface ScheduleOptions {
  /** Modes the destination actually offers; defaults to walk + transit. */
  modes?: TransportMode[];
  /** Pins the day's start (minutes since midnight). Defaults to the earliest time already on the
   *  day, so a reorder keeps the morning the traveler planned instead of drifting. */
  anchorMinutes?: number;
}

/**
 * The anchor a re-schedule cascades from: the EARLIEST readable start on the day, not the first
 * stop's.
 *
 * The difference is the whole behaviour of a reorder. Reading the first stop's time means dragging
 * an evening stop to the top moves the entire day to the evening — drop a 1 PM museum above a 9 AM
 * temple and the day now starts at 1 PM, which nobody asked for. Taking the minimum keeps the
 * morning the traveler planned and re-times everything after it.
 */
function dayAnchor(day: DayPlan, override?: number): number {
  if (override !== undefined) return override;
  let earliest: number | null = null;
  for (const stop of day.stops) {
    const start = parseClock(stop.time ?? "");
    if (start !== null && (earliest === null || start < earliest)) earliest = start;
  }
  return earliest ?? DEFAULT_DAY_START_MIN;
}

/**
 * Recomputes every stop's `time` from the day's anchor, walking the list in its current order and
 * charging each hop its travel time.
 *
 * Durations are preserved — a 2-hour museum stays 2 hours wherever it lands. Only the clock moves.
 */
export function rescheduleDay(day: DayPlan, options: ScheduleOptions = {}): DayPlan {
  if (day.stops.length === 0) return day;

  let cursor = dayAnchor(day, options.anchorMinutes);
  const stops = day.stops.map((stop, i) => {
    // The anchor is left exactly as the traveler's own plan had it; only derived starts get rounded.
    const startAt = i === 0 ? cursor : roundUpToSlot(cursor);
    const timed: Stop = { ...stop, time: formatClock(startAt) };
    cursor = startAt + parseDuration(stop.durationLabel ?? "");
    const next = day.stops[i + 1];
    if (next) cursor += legMinutes(stop, next, options.modes);
    return timed;
  });

  return { ...day, stops };
}

/** A stop's position in the trip. */
export interface StopRef {
  dayIndex: number;
  stopIndex: number;
}

/**
 * Moves a stop within a day or across days, then re-times every day it touched.
 *
 * The insertion index is interpreted against the list *after* the stop is lifted out, which is
 * what a drag actually does — computing it against the original list puts a stop dragged downward
 * one slot short of where it was dropped.
 */
export function moveStop(
  itinerary: Itinerary,
  from: StopRef,
  to: StopRef,
  options: ScheduleOptions = {}
): Itinerary {
  const next: Itinerary = structuredClone(itinerary);
  const source = next.days[from.dayIndex];
  const target = next.days[to.dayIndex];
  if (!source || !target) return itinerary;

  const [moved] = source.stops.splice(from.stopIndex, 1);
  if (!moved) return itinerary;

  const at = Math.max(0, Math.min(to.stopIndex, target.stops.length));
  target.stops.splice(at, 0, moved);

  // Both ends need re-timing, and the same day twice would double-charge nothing but wastes a pass.
  const touched = new Set([from.dayIndex, to.dayIndex]);
  for (const i of touched) next.days[i] = rescheduleDay(next.days[i], options);

  return next;
}

/** Where a stop dropped on another day should land: after the last stop it would still follow in
 *  clock terms, so a morning stop dropped on a new day doesn't append itself after dinner. */
export function insertionIndexByTime(day: DayPlan, stop: Stop): number {
  const at = parseClock(stop.time ?? "");
  if (at === null) return day.stops.length;
  const index = day.stops.findIndex((existing) => {
    const start = parseClock(existing.time ?? "");
    return start !== null && start > at;
  });
  return index === -1 ? day.stops.length : index;
}
