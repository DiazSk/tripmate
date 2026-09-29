import { parseClock } from '@shared/itinerary';

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

/** The clock in `timezone` as somebody would read it aloud — "10:38". */
export function clockInZone(timezone: string | null | undefined, at: Date = new Date()): string | null {
  const minutes = nowInZone(timezone, at);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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
