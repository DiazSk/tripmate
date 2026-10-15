import { aboutDuration } from '@shared/travelTime';

import type { Stop } from '@/api/types';

import { dayLegs, leaveBy } from './dayTravel';
import { describeGap, todayState } from './tripClock';

/**
 * Home's "what now" on a trip, as the widgets draw it (canvas design "Phone home · 4 Widgets with a
 * live next stop"): the next stop and how long before you have to leave for it, the place you are
 * at, and what comes after.
 *
 * **A projection of `todayState`, never a second opinion.** Every figure comes from the same
 * `todayState`, `leaveBy` and `dayLegs` the day page uses; this only chooses the words and the
 * countdown, so the Live Activity and the trip screen can never disagree about when to leave.
 * Pure, so the arms that matter (late, imminent, free) are tested rather than eyeballed.
 */

export type Countdown = { value: string; unit: string };

export type NextGlance = {
  index: number;
  stop: Stop;
  /** "Leave by 12:05" · "Leave in 11 min" · "Leave now" · "Free for about 2 hr" · null. */
  leave: string | null;
  /** The figure in the countdown box: minutes to leave, or the free time. Null when late. */
  countdown: Countdown | null;
  /** "about 25 min by car", the hop from the place before. */
  leg: string | null;
  /** Booked and past the departure: the one alert state, with the sentence that says why. */
  late: string | null;
};

export type Glance =
  | { kind: 'empty' | 'done' }
  | { kind: 'live'; next: NextGlance; at: Stop | null; after: Stop[] };

/** 23 → "23 min"; 125 → "2:05 hr". A box this small holds one figure and its unit. */
export function countdownOf(minutes: number): Countdown {
  if (minutes < 60) return { value: String(minutes), unit: 'min' };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { value: m ? `${h}:${String(m).padStart(2, '0')}` : String(h), unit: 'hr' };
}

export function glanceFor(stops: Stop[], now: number): Glance {
  const state = todayState(stops, now, (i) => leaveBy(stops, i));
  if (state.kind === 'empty' || state.kind === 'done') return { kind: state.kind };

  const { index } = state;
  const stop = stops[index];
  const legOf = dayLegs(stops).find((l) => l.toIndex === index);
  const leg = legOf ? `${aboutDuration(`${legOf.minutes} min`)} by ${legOf.mode}` : null;

  let leave: string | null;
  let countdown: Countdown | null;
  let late: string | null = null;
  switch (state.kind) {
    // First, and load-bearing: `late` carries `leaveBy` too, so it must never fall into "Leave by".
    case 'late':
      leave = 'Leave now';
      countdown = null;
      late = `Booked for ${stop.time}, ${describeGap(state.minutes)} past the departure`;
      break;
    case 'imminent':
      leave = state.minutes === 0 ? 'Leave now' : `Leave in ${describeGap(state.minutes)}`;
      countdown = countdownOf(state.minutes);
      break;
    case 'free':
      leave = `Free for about ${describeGap(state.minutes)}`;
      countdown = countdownOf(state.minutes);
      break;
    case 'upcoming':
      leave = state.leaveBy ? `Leave by ${state.leaveBy}` : null;
      countdown = countdownOf(state.minutes);
      break;
  }

  return { kind: 'live', next: { index, stop, leave, countdown, leg, late }, at: index > 0 ? stops[index - 1] : null, after: stops.slice(index + 1) };
}
