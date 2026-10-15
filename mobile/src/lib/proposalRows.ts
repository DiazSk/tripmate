import { parseClock } from '@shared/itinerary';
import { normalizeStopName } from '@shared/placeConflicts';

import type { DayPlan, Stop } from '@/api/types';
import type { ItineraryDiff } from '@/lib/itineraryDiff';

/**
 * One day as a proposal would leave it, drawn on the day itself rather than listed beside it.
 *
 * The rows are the proposed day's stops in its own order, each marked with what the edit does to
 * it, plus a **ghost** for every stop that leaves this day — at the time it used to hold, so it is
 * struck through where the traveller remembers it rather than gathered into a list at the foot.
 *
 * Read from the same `ItineraryDiff` the summary line is, so the day and the sentence under the
 * reply can never disagree about what moves. Matched by `normalizeStopName`, the diff's own key.
 */
export type ProposalRow =
  | { kind: 'same' | 'added'; stop: Stop }
  | { kind: 'retimed'; stop: Stop; was: string }
  | { kind: 'arriving'; stop: Stop; fromDay: number; was: string }
  | { kind: 'leaving'; stop: Stop; toDay: number; toTime: string }
  | { kind: 'removed'; stop: Stop };

export function proposalRows(before: DayPlan | undefined, after: DayPlan | undefined, dayIndex: number, diff: ItineraryDiff): ProposalRow[] {
  const changes = diff.stops;
  const key = (stop: Stop) => normalizeStopName(stop.name);
  const find = (stop: Stop, test: (c: ItineraryDiff['stops'][number]) => boolean) =>
    changes.find((c) => normalizeStopName(c.name) === key(stop) && test(c));

  const rows: ProposalRow[] = (after?.stops ?? []).map((stop) => {
    const arriving = find(stop, (c) => c.kind === 'moved' && c.toDayIndex === dayIndex);
    if (arriving?.kind === 'moved') return { kind: 'arriving', stop, fromDay: arriving.dayIndex, was: arriving.time };
    const retimed = find(stop, (c) => c.kind === 'retimed' && c.dayIndex === dayIndex);
    if (retimed?.kind === 'retimed') return { kind: 'retimed', stop, was: retimed.time };
    if (find(stop, (c) => c.kind === 'added' && c.dayIndex === dayIndex)) return { kind: 'added', stop };
    return { kind: 'same', stop };
  });

  for (const stop of before?.stops ?? []) {
    const leaving = find(stop, (c) => c.kind === 'moved' && c.dayIndex === dayIndex);
    if (leaving?.kind === 'moved') rows.push({ kind: 'leaving', stop, toDay: leaving.toDayIndex, toTime: leaving.toTime });
    else if (find(stop, (c) => c.kind === 'removed' && c.dayIndex === dayIndex)) rows.push({ kind: 'removed', stop });
  }

  // Stable, so the proposed day keeps its own order and a ghost slots in at its old time. An
  // unreadable clock sorts last rather than throwing the day off, as the diff's own sort does.
  const at = (row: ProposalRow) => parseClock(row.stop.time ?? '') ?? 1441;
  return rows.map((row, i) => ({ row, i })).sort((a, b) => at(a.row) - at(b.row) || a.i - b.i).map(({ row }) => row);
}
