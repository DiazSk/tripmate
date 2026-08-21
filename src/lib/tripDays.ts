import type { DayPlan, Itinerary } from "./types";

/**
 * Adding and removing whole days from a trip.
 *
 * The invariant everything here maintains: a trip's days are CONTIGUOUS calendar dates starting at
 * its `startDate`, so `days[i].date === startDate + i` and `endDate === startDate + (length - 1)`.
 * Insert or remove a day anywhere and every later date re-flows — which is why callers never set a
 * date themselves, they change the list and let `redateDays` restate all of them.
 *
 * `startDate` is deliberately immutable. Inserting "before day 1" shifts the existing content later
 * rather than moving the trip's first date, because the start date is the one a traveller has
 * usually already booked a flight against; the end date is the cheap end to move.
 *
 * Every date is handled in UTC. `new Date("2026-09-19")` is UTC midnight, and formatting it with
 * local accessors rolls back a day anywhere west of Greenwich — which has already put a wrong
 * day-of-week into generated output once in this codebase.
 */

/** ISO calendar date plus/minus whole days, in UTC. Returns "" for an unparseable input. */
export function shiftISODate(iso: string, days: number): string {
  const at = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(at)) return "";
  const shifted = new Date(at);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (b - a). NaN-safe: returns 0 if either is unparseable. */
export function daysBetweenISO(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** The date a trip ends on, given where it starts and how many days it now has. */
export function tripEndDate(startISO: string, dayCount: number): string {
  return shiftISODate(startISO, Math.max(0, dayCount - 1));
}

/** Restates every day's date as consecutive days from `startISO`, leaving all other fields alone. */
export function redateDays(days: DayPlan[], startISO: string): DayPlan[] {
  return days.map((day, i) => {
    const date = shiftISODate(startISO, i);
    return date && date !== day.date ? { ...day, date } : day;
  });
}

/** A day with nothing in it yet. Weather is left blank rather than guessed: the edit path is frozen
 *  (no forecast lookup), and inventing one would put a fabricated fact in front of the traveller. */
export function blankDay(date: string): DayPlan {
  return { date, weather: "", stops: [] };
}

/**
 * Inserts an empty day at `atIndex` (clamped; `atIndex >= length` appends) and re-dates the trip.
 *
 * The trip gets one day longer, so its end date moves out by one — callers read the new end off
 * `tripEndDate` or simply the last day's date.
 */
export function insertDay(itinerary: Itinerary, atIndex: number): Itinerary {
  const startISO = itinerary.days[0]?.date;
  if (!startISO) return itinerary;

  const days = [...itinerary.days];
  const at = Math.max(0, Math.min(atIndex, days.length));
  days.splice(at, 0, blankDay(""));
  return { ...itinerary, days: redateDays(days, startISO) };
}

/** Removes a day and re-dates the rest. Refuses to empty the trip — a trip with no days is not a
 *  shorter trip, it's a broken record, and nothing downstream renders it. */
export function removeDay(itinerary: Itinerary, dayIndex: number): Itinerary {
  const startISO = itinerary.days[0]?.date;
  if (!startISO || itinerary.days.length <= 1) return itinerary;
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= itinerary.days.length) {
    return itinerary;
  }

  const days = itinerary.days.filter((_, i) => i !== dayIndex);
  return { ...itinerary, days: redateDays(days, startISO) };
}
