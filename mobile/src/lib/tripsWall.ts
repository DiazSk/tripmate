import type { TripSummary } from '@/api/types';

/**
 * How the Trips tab arranges itself: coming up in a carousel, remembered in a grid.
 *
 * The tab was called Memories and held both a trip to Jaipur that happened and a trip to Lisbon
 * that has not — a future trip is not a memory. So the wall is "Trips", split by whether the
 * trip has finished, and the split needs a rule that does not lie on the last day of a trip:
 * **a trip counts as upcoming until the day after it ends**, because somebody standing in Lisbon
 * on the final afternoon has not acquired a memory yet.
 *
 * **Dates are compared as ISO strings, never parsed.** `2026-09-19` sorts correctly as text, and
 * `new Date('2026-09-19')` is UTC midnight — the trap this codebase has already shipped once.
 */

/** Today as `YYYY-MM-DD`. The one clock read; every rule below takes it as an argument. */
export const todayISO = () => new Date().toISOString().slice(0, 10);

export const isUpcoming = (trip: TripSummary, today: string) => trip.endDate >= today;

/**
 * The two shelves, each in its own order: upcoming soonest first, so the next trip leads the
 * carousel; past most recent first, so the grid opens on the trip you just came back from.
 */
export function tripShelves(trips: TripSummary[], today: string): { upcoming: TripSummary[]; past: TripSummary[] } {
  return {
    upcoming: trips.filter((trip) => isUpcoming(trip, today)).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    past: trips.filter((trip) => !isUpcoming(trip, today)).sort((a, b) => b.endDate.localeCompare(a.endDate)),
  };
}

/** The search bar's rule: any part of the destination, or the month and year it starts ("nov 2026"). */
export function matchesQuery(trip: TripSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const month = new Date(`${trip.startDate}T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toLowerCase();
  return trip.destination.toLowerCase().includes(q) || month.includes(q) || month.replace(/(\w{3})\w*/, '$1').includes(q);
}
