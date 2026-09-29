import type { TripSummary } from '@/api/types';

/**
 * Where a trip sits in time — the lifecycle this product did not have.
 *
 * `TripStatus` is `"draft" | "saved"`: whether somebody kept the plan, not whether they are on
 * it. Nothing anywhere derived in-progress from the two dates every trip has already carried,
 * which is why there was no answer to "what do I do now".
 *
 * **Dates are compared as ISO text, never parsed.** `new Date('2026-09-19')` is UTC midnight and
 * formats as the 18th anywhere west of Greenwich — a bug this repo has already shipped once and
 * which `tripsWall.ts` documents at length. `YYYY-MM-DD` sorts correctly as a string, so string
 * comparison is both simpler and the only correct option.
 *
 * **This does not replace `isUpcoming`.** The wall asks "is this a memory yet" and answers with
 * `endDate >= today`, which deliberately counts the final afternoon as upcoming. That is a
 * different question from "which day of this trip is today", and both are right. `'today'` and
 * `'eve'` are strict subsets of `isUpcoming`.
 */
export type TripPhase = 'upcoming' | 'eve' | 'today' | 'past';

/** `YYYY-MM-DD` one day before `date`, via UTC accessors so no local offset can shift it. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * **`today` outranks `eve`**, which matters on the one day a trip ends and another begins: you
 * are standing in the first trip, and a screen about tomorrow's flight is not what you need.
 *
 * The eve exists because the evening before departure is when the first stop's time and anything
 * already booked start to matter, and the trip screen is the wrong shape for that question.
 */
export function tripPhase(
  trip: { startDate: string; endDate: string },
  today: string
): TripPhase {
  if (today >= trip.startDate && today <= trip.endDate) return 'today';
  if (today === dayBefore(trip.startDate)) return 'eve';
  return today < trip.startDate ? 'upcoming' : 'past';
}

/**
 * Which itinerary day today is, or null when the trip is not running.
 *
 * Index, not day number — it addresses `itinerary.days[]` directly. Deliberately null rather than
 * 0 outside the trip: a caller that forgot to check the phase should get an obvious absence, not
 * silently be handed day one.
 */
export function dayIndexFor(
  trip: { startDate: string; endDate: string },
  today: string
): number | null {
  if (tripPhase(trip, today) !== 'today') return null;
  return daysBetween(trip.startDate, today);
}

/**
 * The one trip Home should be about, from every trip somebody kept.
 *
 * **The tie is not hypothetical.** This developer's own database holds trips that overlap, and
 * two of them share a start date — Lisbon (Oct 22–28) and Kyoto (Oct 22–24) are both running on
 * Oct 23. So "the most recently started" is not by itself an answer, and a comparator that
 * returns 0 leaves the result at the mercy of the server's row order: Home would show a different
 * trip on different refetches, which reads as a bug even though each answer is defensible.
 *
 * A total order, therefore: **started most recently, then ending soonest, then by id.** The first
 * clause is the real rule — the trip you travelled to last is the one you are on. The second
 * prefers the shorter of two overlapping trips, which is the likelier one to be a real stay. The
 * third decides nothing meaningful and exists only so the answer never changes between two reads
 * of the same data.
 *
 * A trip whose eve is today wins only when no trip is actually running, so the night before
 * departure does not displace a trip you are still on.
 */
export function pickCurrent<T extends TripSummary>(trips: T[], today: string): T | null {
  const byPhase = (phase: TripPhase) =>
    trips
      .filter((trip) => tripPhase(trip, today) === phase)
      .sort(
        (a, b) =>
          b.startDate.localeCompare(a.startDate) ||
          a.endDate.localeCompare(b.endDate) ||
          a.id.localeCompare(b.id)
      );

  return byPhase('today')[0] ?? byPhase('eve')[0] ?? null;
}
