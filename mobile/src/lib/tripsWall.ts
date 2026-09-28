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
 * A two-column grid whose last row holds one tile would stretch it across the full width —
 * `flex: 1` has nothing to share the row with — and an `aspectRatio` photo then becomes enormous.
 * A phantom cell keeps every tile exactly the width it has in a full row, which `maxWidth: '50%'`
 * would only approximate once the column gap is counted.
 *
 * A header is padded the same way, for the same reason: it occupies the leading half of its own
 * row so that the tile after it starts a fresh pair.
 */
export type WallItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'trip'; key: string; trip: TripSummary }
  | { kind: 'spacer'; key: string };

/**
 * Upcoming first, soonest at the top; then past, most recent at the top.
 *
 * **Headers appear only when both sections have something in them.** A lone "PAST" over a wall
 * where everything is past is a label that distinguishes nothing, and the wall read better
 * without one before this existed.
 */
export function wallItems(trips: TripSummary[], today: string): WallItem[] {
  const upcoming = trips
    .filter((trip) => isUpcoming(trip, today))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = trips
    .filter((trip) => !isUpcoming(trip, today))
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  const labelled = upcoming.length > 0 && past.length > 0;
  return [
    ...section('upcoming', 'Upcoming', upcoming, labelled),
    ...section('past', 'Past', past, labelled),
  ];
}

function section(id: string, label: string, trips: TripSummary[], labelled: boolean): WallItem[] {
  if (trips.length === 0) return [];
  const head: WallItem[] = labelled
    ? [
        { kind: 'header', key: `${id}-header`, label },
        { kind: 'spacer', key: `${id}-header-pad` },
      ]
    : [];
  const tiles: WallItem[] = trips.map((trip) => ({ kind: 'trip', key: trip.id, trip }));
  // Pad an odd section so the next one starts on a fresh row rather than sharing the last.
  if (tiles.length % 2 === 1) tiles.push({ kind: 'spacer', key: `${id}-pad` });
  return [...head, ...tiles];
}
