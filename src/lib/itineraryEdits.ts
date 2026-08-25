// `import type`, not a plain import: `DayPlan`/`Itinerary`/`Stop` are interfaces, and Node
// erases a type-only import but keeps a value one — so a plain import here makes this module
// unloadable from a `.test.mjs` with "does not provide an export named 'DayPlan'". See the
// note in CLAUDE.md; this is the same trap that keeps `generationRunner.ts` script-unreachable.
import type { DayPlan, Itinerary, Stop } from "./types";

/**
 * The whole-itinerary edits the split editor performs, as pure functions.
 *
 * Separate from the component for the reason `schedule.ts` and `guardrails.ts` already are: this
 * is the logic that can be wrong in ways typechecking cannot see — an off-by-one that silently
 * drops a stop, a new day dated a month out — and the test suite here only reaches pure modules.
 * Reordering and cross-day moves are NOT here; `moveStop`/`insertionIndexByTime` in `schedule.ts`
 * already own those and re-time the day around them.
 *
 * Every function returns a new `Itinerary` and mutates nothing, so a caller can hand the result
 * straight to React state.
 */

/** A day at UTC midnight, plus `days`, formatted back as `YYYY-MM-DD`.
 *
 *  UTC throughout, per the calendar-date rule in CLAUDE.md: `new Date("2026-09-19")` parses as
 *  UTC midnight, so reading it back with local accessors rolls to the 18th anywhere west of
 *  Greenwich — which is exactly how a wrong day-of-week reaches generated output. */
function addCalendarDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** The default shape of a stop added by hand. The model fills `why`/`durationLabel`/`cost` on a
 *  generated stop; a hand-added one has none of that yet and must not pretend to. `cost: 0` is
 *  the honest answer rather than a guess, and it keeps the day's arithmetic intact. */
export function newStop(name: string, lat: number, lng: number): Stop {
  return {
    name,
    lat,
    lng,
    cost: 0,
    note: "",
    time: "",
    durationLabel: "",
    category: "other",
  };
}

/**
 * Append an empty day.
 *
 * Dated the day after the current last one, so the trip stays a contiguous run of dates — every
 * consumer (the print page, the day tabs, `formatItineraryDate`) reads `DayPlan.date` and assumes
 * that. An itinerary with no days at all falls back to today, since there is no previous date to
 * count from and refusing to add the first day would leave the button dead.
 */
export function addDay(itinerary: Itinerary, todayIso?: string): Itinerary {
  const last = itinerary.days[itinerary.days.length - 1];
  const date = last
    ? addCalendarDays(last.date, 1)
    : (todayIso ?? new Date().toISOString().slice(0, 10));
  const day: DayPlan = { date, weather: "", stops: [] };
  return { ...itinerary, days: [...itinerary.days, day] };
}

/** Insert a stop into a day, positioned by clock time when it has one and appended when it does
 *  not — a hand-added stop starts with no time, and guessing a slot for it would move the day's
 *  existing stops around for no reason the traveler asked for. */
export function insertStop(
  itinerary: Itinerary,
  dayIndex: number,
  stop: { name: string; lat: number; lng: number }
): Itinerary {
  const day = itinerary.days[dayIndex];
  if (!day) return itinerary;
  const next = newStop(stop.name, stop.lat, stop.lng);
  const days = itinerary.days.map((d, i) =>
    i === dayIndex ? { ...d, stops: [...d.stops, next] } : d
  );
  return { ...itinerary, days };
}

/** Patch one stop in place. */
export function updateStop(
  itinerary: Itinerary,
  dayIndex: number,
  stopIndex: number,
  patch: Partial<Stop>
): Itinerary {
  const day = itinerary.days[dayIndex];
  if (!day || !day.stops[stopIndex]) return itinerary;
  const days = itinerary.days.map((d, i) =>
    i === dayIndex
      ? { ...d, stops: d.stops.map((s, j) => (j === stopIndex ? { ...s, ...patch } : s)) }
      : d
  );
  return { ...itinerary, days };
}

/** Remove one stop. The day survives empty rather than being removed with its last stop — a day
 *  of the trip still exists whether or not anything is planned in it, and deleting it here would
 *  silently renumber every day after it. */
export function deleteStop(itinerary: Itinerary, dayIndex: number, stopIndex: number): Itinerary {
  const day = itinerary.days[dayIndex];
  if (!day || !day.stops[stopIndex]) return itinerary;
  const days = itinerary.days.map((d, i) =>
    i === dayIndex ? { ...d, stops: d.stops.filter((_, j) => j !== stopIndex) } : d
  );
  return { ...itinerary, days };
}
