import { parseClock } from '@shared/itinerary';
import { normalizeStopName } from '@shared/placeConflicts';

import type { DayPlan, Itinerary, Stop } from '@/api/types';
import { tripSpend } from '@/lib/spend';

/**
 * What one edit would actually do to a plan.
 *
 * **The model already says what it changed, and that is not the same thing.** `/api/trip-edit`
 * returns a `changes` list, a `why` and a `knockOn`, all of them the model's own prose about its
 * own work — unverified, and written before the patch applier had a chance to refuse any of it.
 * This compares the two itineraries instead, so what a traveler approves is what will happen.
 *
 * **Stops are matched by normalized name, because a `Stop` has no id.** `normalizeStopName` is
 * the same key `checkDuplicates` and the place-facts lookup already use, so the model's
 * capitalisation and punctuation drift is absorbed here exactly as it is there. A rename is
 * therefore read as a removal plus an addition, which is the honest reading: nothing in the two
 * plans says the two rows are the same place, and claiming otherwise would hide a swap.
 *
 * Same name twice in one plan is paired in reading order — the second "Lunch" before the edit is
 * the second "Lunch" after it.
 *
 * **Clock times go through `parseClock`, never compared as strings.** This app's stored plans
 * hold "1:00 PM"; the schema and older plans hold "13:00"; and the two spell the same instant.
 * Sorted as text, "10:00 AM" also sorts before "9:00 AM", so a day's changes would be listed in
 * an order nobody walks.
 */

/** Minutes since midnight, or null when the clock is unreadable. */
const at = (time: string) => parseClock(time);

/** Same instant, whichever way the two plans happen to spell it. */
const sameTime = (a: string, b: string) => {
  const left = at(a);
  const right = at(b);
  return left === null || right === null ? a.trim() === b.trim() : left === right;
};

export type StopChange =
  | { kind: 'added'; name: string; dayIndex: number; time: string }
  | { kind: 'removed'; name: string; dayIndex: number; time: string }
  | { kind: 'moved'; name: string; dayIndex: number; toDayIndex: number; time: string; toTime: string }
  | { kind: 'retimed'; name: string; dayIndex: number; time: string; toTime: string };

export interface ItineraryDiff {
  /** In reading order: by the day they start on, then by time. */
  stops: StopChange[];
  /** Every day index either side of the edit touches, ascending. */
  days: number[];
  spendBefore: number;
  spendAfter: number;
  /**
   * Booked stops the edit would move, retime or drop, by name.
   *
   * **This should always be empty**, because `refusesLock` rejects those ops server-side. It is
   * computed anyway and shown as a line that says "nothing moved", because the whole value of
   * marking something booked is the promise that it stays put, and a promise is worth restating
   * at the moment somebody is being asked to approve a change.
   */
  lockedTouched: string[];
  /** The model answered without changing the plan — a question, or a refusal. */
  empty: boolean;
}

interface Placed {
  stop: Stop;
  dayIndex: number;
}

const place = (days: DayPlan[]): Placed[] =>
  days.flatMap((day, dayIndex) => day.stops.map((stop) => ({ stop, dayIndex })));

/** Name → the stops under it, in reading order. */
function byName(placed: Placed[]): Map<string, Placed[]> {
  const index = new Map<string, Placed[]>();
  for (const entry of placed) {
    const key = normalizeStopName(entry.stop.name);
    const found = index.get(key);
    if (found) found.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

export function diffItineraries(before: Itinerary, after: Itinerary): ItineraryDiff {
  const from = byName(place(before.days));
  const to = byName(place(after.days));
  const stops: StopChange[] = [];

  for (const [key, olds] of from) {
    const news = to.get(key) ?? [];
    const paired = Math.min(olds.length, news.length);
    for (let i = 0; i < paired; i++) {
      const was = olds[i];
      const now = news[i];
      if (was.dayIndex !== now.dayIndex) {
        stops.push({
          kind: 'moved',
          name: now.stop.name,
          dayIndex: was.dayIndex,
          toDayIndex: now.dayIndex,
          time: was.stop.time,
          toTime: now.stop.time,
        });
      } else if (!sameTime(was.stop.time, now.stop.time)) {
        stops.push({
          kind: 'retimed',
          name: now.stop.name,
          dayIndex: was.dayIndex,
          time: was.stop.time,
          toTime: now.stop.time,
        });
      }
    }
    for (const gone of olds.slice(paired)) {
      stops.push({
        kind: 'removed',
        name: gone.stop.name,
        dayIndex: gone.dayIndex,
        time: gone.stop.time,
      });
    }
  }

  for (const [key, news] of to) {
    const olds = from.get(key) ?? [];
    for (const fresh of news.slice(olds.length)) {
      stops.push({
        kind: 'added',
        name: fresh.stop.name,
        dayIndex: fresh.dayIndex,
        time: fresh.stop.time,
      });
    }
  }

  // An unreadable clock sorts last within its day rather than throwing the whole list off.
  stops.sort((a, b) => a.dayIndex - b.dayIndex || (at(a.time) ?? 1441) - (at(b.time) ?? 1441));

  const lockedNames = new Set(
    place(before.days)
      .filter((entry) => entry.stop.timeFlexibility === 'FIXED')
      .map((entry) => normalizeStopName(entry.stop.name))
  );

  return {
    stops,
    days: [
      ...new Set(
        stops.flatMap((change) =>
          change.kind === 'moved' ? [change.dayIndex, change.toDayIndex] : [change.dayIndex]
        )
      ),
    ].sort((a, b) => a - b),
    spendBefore: tripSpend(before.days),
    spendAfter: tripSpend(after.days),
    lockedTouched: [
      ...new Set(
        stops.filter((c) => lockedNames.has(normalizeStopName(c.name))).map((c) => c.name)
      ),
    ],
    // Spend alone can move without a stop moving — a re-costed stop is a change worth approving,
    // even though nothing was added, dropped or rescheduled.
    empty: stops.length === 0 && tripSpend(before.days) === tripSpend(after.days),
  };
}

/**
 * `Day 2 updated` · `Days 2 and 4 updated` · `3 days updated`.
 *
 * Named while there are few enough to name, counted once there are not: "Days 1, 2, 3, 5 and 6
 * updated" is a sentence nobody finishes reading, and the point of the line is that it can be
 * read at a glance on the way past. Day numbers are 1-based — they are being read, not indexed.
 */
export function daysUpdatedLabel(days: number[]): string {
  const named = days.map((d) => d + 1);
  if (named.length === 0) return 'Plan updated';
  if (named.length === 1) return `Day ${named[0]} updated`;
  if (named.length === 2) return `Days ${named[0]} and ${named[1]} updated`;
  return `${named.length} days updated`;
}
