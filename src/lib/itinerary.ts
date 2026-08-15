import { Itinerary, Stop } from "./types";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-09-10" -> "Sep 10" if 2026 is the current year, else "Sep 10, '26".
 * Parses the ISO date as a local calendar date via manual split rather than
 * `new Date(iso)` (which parses as UTC midnight and can roll back a day for
 * anyone west of Greenwich) — same reasoning as `todayISO` in src/app/page.tsx.
 */
export function formatItineraryDate(iso: string): string {
  const parts = (iso ?? "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return iso ?? "";
  const [year, month, day] = parts;
  const monthName = MONTH_NAMES[month - 1];
  if (!monthName) return iso;
  const base = `${monthName} ${day}`;
  return year === new Date().getFullYear() ? base : `${base}, '${String(year).slice(2)}`;
}

/** Matches by name+lat+lng rather than object identity — callers often hold a
 *  Stop reference that's a structural copy of the one inside `itinerary`. */
export function findStopLocation(
  itinerary: Itinerary,
  stop: Stop
): { dayIndex: number; stopIndex: number } | null {
  for (let d = 0; d < itinerary.days.length; d++) {
    const s = itinerary.days[d].stops.findIndex(
      (x) => x.name === stop.name && x.lat === stop.lat && x.lng === stop.lng
    );
    if (s !== -1) return { dayIndex: d, stopIndex: s };
  }
  return null;
}

/** Remaining stops for the same day, after the given stop — used to power the
 *  "Next Up" quick-navigation list in PlaceDetailPanel. */
export function upcomingStopsAfter(itinerary: Itinerary, stop: Stop): Stop[] {
  const loc = findStopLocation(itinerary, stop);
  if (!loc) return [];
  return itinerary.days[loc.dayIndex].stops.slice(loc.stopIndex + 1);
}
