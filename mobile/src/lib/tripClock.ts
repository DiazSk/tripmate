import { dayClocks, formatClock, parseClock, parseDuration } from '@shared/itinerary';

import type { Stop } from '@/api/types';

import { dayBefore, dayIndexFor } from './tripPhase';

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
  // `dayClocks` rolls a stop after midnight forward (1:00 AM after a 10 PM dinner is 1500), so a
  // `nowMinutes` past 1440 — 00:15 while the previous day is still running, see `tripClockNow` —
  // compares against it on one line. For a day that never crosses midnight it is `parseClock`.
  const clocks = dayClocks(stops);
  for (let i = 0; i < clocks.length; i++) {
    const at = clocks[i];
    if (at !== null && at > nowMinutes) return i;
  }
  return null;
}

/**
 * When the day's last stop ends, in the day's own minutes (past 1440 when it runs on after
 * midnight), or null when no stop has a readable time. The latest start + duration rather than the
 * last row's, since a plan's order is not a promise about which stop runs longest. A duration that
 * will not parse counts as zero (`parseDuration`): the stop still marks where the day got to.
 */
export function dayEnd(stops: Stop[]): number | null {
  const clocks = dayClocks(stops);
  let end: number | null = null;
  clocks.forEach((start, i) => {
    if (start === null) return;
    const stopEnd = start + parseDuration(stops[i]?.durationLabel ?? '');
    if (end === null || stopEnd > end) end = stopEnd;
  });
  return end;
}

/**
 * **Which day it is, and what minute of it, where the trip is — the one rule every "today" reads.**
 *
 * A day's plan can run past midnight (a 10 PM dinner for two hours, a booked 12:30 AM stop), and
 * the calendar does not care: at 00:15 a clock-and-date reading says it is day 4 and the traveller,
 * who is still out on day 3, loses the stops of the night they are in. So the previous day stays
 * current until its last stop has ended (`dayEnd`), and only then does the new one begin.
 *
 * `today` is the date of the *itinerary day* in force, which is yesterday's date while one is
 * carrying over, so `dayIndexFor`, `tripPhase` and `openingDay` need no second rule. `minutes` is
 * on that day's own clock: 1455 for 00:15 carried over, matching the rolled stops (`dayClocks`).
 * Null without a timezone, as everything here is: the device's clock is not the destination's.
 *
 * The last day carries over too: its date stays `today` after midnight rather than flipping to
 * "past" while its last stop is still running.
 */
export function tripClockNow(
  trip: { startDate: string; endDate: string; timezone?: string | null; itinerary: { days: { stops?: Stop[] }[] } },
  at: Date = new Date()
): { today: string; minutes: number } | null {
  const date = todayInZone(trip.timezone, at);
  const minutes = nowInZone(trip.timezone, at);
  if (date === null || minutes === null) return null;

  // Dates stay ISO text and the day index comes from `dayIndexFor`, which is UTC arithmetic, so
  // no device offset can shift the day (see `tripPhase.ts`).
  const yesterday = dayBefore(date);
  const index = dayIndexFor(trip, yesterday);
  const end = index === null ? null : dayEnd(trip.itinerary.days[index]?.stops ?? []);
  if (end !== null && minutes + 1440 < end) return { today: yesterday, minutes: minutes + 1440 };
  return { today: date, minutes };
}

/**
 * The minute to leave for `stops[index]`, from the clock text `leaveBy` returned for it, on the
 * same rolled clock as `dayClocks`. `leaveBy` formats modulo a day, so "12:20 AM" for a 12:30 AM
 * stop would read as 20 against a stop at 1470; the gap to the stop is taken instead and
 * subtracted from the stop's own rolled start. Null when there is no departure or a time will not parse.
 */
export function leaveMinute(stops: Stop[], index: number, leave: string | null): number | null {
  const start = dayClocks(stops)[index];
  const stopRaw = parseClock(stops[index]?.time);
  const leaveRaw = leave === null ? null : parseClock(leave);
  if (start == null || stopRaw === null || leaveRaw === null) return null;
  return start - ((stopRaw - leaveRaw + 1440) % 1440);
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
  /**
   * The departure is behind you and the stop is booked.
   *
   * **Gated on booked, not on lateness alone.** A flexible stop reached late is a day that
   * slipped, which is worth saying quietly; a reservation you can no longer reach under the
   * current estimate is the one thing on this screen coral is actually for. Without the gate the
   * alert colour would fire on an ordinary slow morning, which is how a colour stops meaning
   * anything.
   *
   * `minutes` counts *past* the departure, where every other arm counts down to something.
   */
  | { kind: 'late'; index: number; leaveBy: string; minutes: number }
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

  // Off the rolled clocks rather than `minutesUntil`, which reads the stop's own text and would
  // put a 12:30 AM stop 22 hours behind a `nowMinutes` of 1455.
  const startAt = dayClocks(stops)[index];
  if (startAt === null || startAt === undefined) return { kind: 'done' };
  const until = Math.max(0, startAt - nowMinutes);

  const leaveBy = leaveByFor(index);

  // Measured from the departure where there is one, and from the stop itself otherwise — the
  // question "how long have I got" means until I must leave, not until I am expected.
  //
  // **`raw` before the clamp, because the clamp is what erases the answer.** `Math.max(0, …)`
  // below makes a departure ten minutes gone indistinguishable from one due this second, and
  // those are the two states the alert colour has to tell apart. The window is real: `nextStop`
  // keys on `at > now`, so at 12:20 a 12:30 stop is still next while its 12:10 departure has
  // passed — the window is as wide as the leg is long.
  const raw = leaveBy === null ? until : (leaveMinute(stops, index, leaveBy) ?? 0) - nowMinutes;

  // Strictly `< 0`: standing at the departure minute is the last honest moment to go, not a
  // missed one.
  if (leaveBy !== null && raw < 0 && stops[index]?.timeFlexibility === 'FIXED') {
    return { kind: 'late', index, leaveBy, minutes: -raw };
  }

  const slack = leaveBy === null ? until : Math.max(0, raw);

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
