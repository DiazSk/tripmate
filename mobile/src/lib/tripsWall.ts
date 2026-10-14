import type { TripSummary } from '@/api/types';

/**
 * How the trips wall arranges itself.
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
 * The wall's order: upcoming first, soonest at the top; then past, most recent at the top. One
 * column of postcards, so there are no section headers to pad: each card's own flag says where it
 * stands ("In 30 days", "Happening now"), and a past one carries none.
 */
export function wallOrder(trips: TripSummary[], today: string): TripSummary[] {
  const upcoming = trips
    .filter((trip) => isUpcoming(trip, today))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = trips
    .filter((trip) => !isUpcoming(trip, today))
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
  return [...upcoming, ...past];
}
