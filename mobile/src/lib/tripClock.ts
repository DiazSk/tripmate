import { formatClock, parseClock } from '@shared/itinerary';

import type { Stop } from '@/api/types';

/**
 * What time it is where the trip is, and which stop that makes next.
 *
 * **The device's clock is not an approximation of the destination's.** Measured on the
 * simulator: a phone reading 21:07 on Sep 28 is Lisbon 05:07 on Sep **29**. A screen that
 * trusted the device would not merely show the wrong hour, it would open the wrong day of the
 * itinerary. So every function here takes the trip's IANA zone, and every one of them refuses
 * to answer without it.
 */

/** Minutes since midnight in `timezone`, or null when there is no zone to ask about. */
export function nowInZone(timezone: string | null | undefined, at: Date = new Date()): number | null {
  if (!timezone) return null;
  try {
    // `hourCycle: 'h23'` rather than `hour12: false`, which yields "24" for midnight in some ICU
    // builds and would put the first minute of the day 1440 minutes in.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const hour = get('hour');
    const minute = get('minute');
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    // An unknown zone, or a JS engine without full ICU. Verified present on Hermes under RN 0.86,
    // but a caller must still degrade rather than crash — absence is already a state this screen
    // draws, and it is the honest one.
    return null;
  }
}

/** Today's date in `timezone` as `YYYY-MM-DD`, which is the day of the trip you are actually on. */
export function todayInZone(timezone: string | null | undefined, at: Date = new Date()): string | null {
  if (!timezone) return null;
  try {
    // `en-CA` formats as YYYY-MM-DD, which is the shape every date comparison here expects.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at);
  } catch {
    return null;
  }
}

/**
 * The clock in `timezone`, written the way every other time in this app is written.
 *
 * `formatClock` rather than a local template, for two reasons found on screen. A 24-hour header
 * over a list of stops reading "11:00 AM" is two clocks on one screen, and the reader has to
 * convert between them at the exact moment they are trying to catch a tram. And the display face
 * cuts its zero with a slash, so a padded "05:22" renders as "Ø5:22".
 */
export function clockInZone(timezone: string | null | undefined, at: Date = new Date()): string | null {
  const minutes = nowInZone(timezone, at);
  return minutes === null ? null : formatClock(minutes);
}

/**
 * The first stop that has not started yet.
 *
 * **Start time, not end.** A stop you are standing in is behind you as far as "where do I go
 * next" is concerned — the question this answers is which place to move towards, and the answer
 * while you are eating lunch is the thing after lunch. `durationLabel` is prose ("1.5 hours",
 * "45 min") rather than a number, so an end time would have to be parsed out of English before
 * it could be wrong in a second way.
 *
 * Stops whose clock will not parse are skipped, not treated as midnight: a plan carrying one
 * unreadable time should lose that row from the reckoning, not have its whole order inverted.
 * The list is scanned in order rather than sorted, because the plan's order *is* the day.
 *
 * Null when the day is over, empty, or has no readable time in it. Every one of those is a real
 * answer and the screen says something different for each.
 */
export function nextStop(stops: Stop[], nowMinutes: number): number | null {
  for (let i = 0; i < stops.length; i++) {
    const at = parseClock(stops[i]?.time);
    if (at !== null && at > nowMinutes) return i;
  }
  return null;
}

/**
 * How long until that stop starts, in minutes. Negative is not possible by construction.
 *
 * Kept apart from `nextStop` so a caller can ask about any stop, and so the index and the
 * countdown cannot fall out of step with each other.
 */
export function minutesUntil(stop: Stop | undefined, nowMinutes: number): number | null {
  if (!stop) return null;
  const at = parseClock(stop.time);
  return at === null ? null : Math.max(0, at - nowMinutes);
}

/**
 * What Today should be saying right now.
 *
 * The screen had one rendering — the next stop and its time — which is right at 10:15 and
 * useless at 6:27, when the next thing is four hours away and the screen amounts to "see you at
 * half ten". The answer is not to show the whole day; that is the Day screen's job and Today is
 * an execution surface. The answer is that the *interval* is itself information.
 *
 * **`leaveBy` is the headline wherever it exists**, because on an execution surface the moment
 * you have to go outranks the moment you are due. It does not always exist: it is computed from
 * the previous stop, and the first stop of a day has no origin — `Lodging` carries a name, a
 * cost and a note, no coordinates. So the first stop of the day reports its start time and the
 * wait, and never a departure time, because there is nothing honest to derive one from.
 */
export type TodayState =
  | { kind: 'imminent'; index: number; leaveBy: string; minutes: number }
  | { kind: 'upcoming'; index: number; leaveBy: string | null; minutes: number }
  | { kind: 'free'; index: number; minutes: number }
  | { kind: 'done' }
  | { kind: 'empty' };

/** Inside this, the countdown leads: you are about to have to move. */
export const IMMINENT_MINUTES = 30;
/** Past this, the wait is the story rather than the stop. Below it, the stop still is. */
export const FREE_MINUTES = 90;

export function todayState(
  stops: Stop[],
  nowMinutes: number,
  leaveByFor: (index: number) => string | null
): TodayState {
  if (stops.length === 0) return { kind: 'empty' };

  const index = nextStop(stops, nowMinutes);
  if (index === null) return { kind: 'done' };

  const until = minutesUntil(stops[index], nowMinutes);
  if (until === null) return { kind: 'done' };

  const leaveBy = leaveByFor(index);

  // Measured from the departure where there is one, and from the stop itself otherwise — the
  // question "how long have I got" means until I must leave, not until I am expected.
  const slack = leaveBy === null ? until : Math.max(0, (parseClock(leaveBy) ?? 0) - nowMinutes);

  if (leaveBy !== null && slack <= IMMINENT_MINUTES) {
    return { kind: 'imminent', index, leaveBy, minutes: slack };
  }
  if (slack >= FREE_MINUTES) return { kind: 'free', index, minutes: slack };
  return { kind: 'upcoming', index, leaveBy, minutes: until };
}

/** "3 hr 30 min", "45 min" — the wait as somebody would say it, never "0 hr". */
export function describeGap(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
