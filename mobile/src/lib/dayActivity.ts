import { dayClocks } from '@shared/itinerary';
import type { TransportMode } from '@shared/types';

import type { Stop } from '@/api/types';

import { dayLegs, leaveBy } from './dayTravel';
import { describeGap, leaveMinute, todayState } from './tripClock';

/**
 * A trip day in the Dynamic Island and on the Lock Screen: the canvas design "Live Activity · 1
 * Day clock". The next stop, its photograph as the artwork, and when to leave for it: the leave-by
 * time while it is far off, a countdown once it matters (30 min), "Now" when it is time or late.
 *
 * **A projection of `todayState`, never a second opinion**, as `todayGlance.ts` is for Home: the
 * same `todayState`, `leaveBy` and `dayLegs`, so the island and the day page cannot disagree.
 *
 * **Without push.** The free Apple team has none, so the activity is updated only while the app is
 * open. Every transition of a day is a known time, though, so each update carries the face for now
 * **and the face after the next transition** (`next`), with `staleAt` at that moment: when iOS marks
 * the activity stale the widget draws `next`. The countdown and the leg's bar run on iOS's own clock
 * (`timerInterval`). So a day moves one step on its own, and every time the app is opened it is
 * brought back up to date.
 */
export type DayKind = 'free' | 'upcoming' | 'imminent' | 'late' | 'done';

/** One moment of the day as the island draws it. Times are epoch ms; text is final. */
export type DayFace = {
  kind: DayKind;
  /** "Next · 12:30 PM · booked", or "Lisbon · day 3 done". */
  eyebrow: string;
  /** The stop, or "That's the day". */
  title: string;
  /** "Leave by 12:10 PM · 15 min walking", "Free for about 2 hr 10 min", "10 min past the departure". */
  sub: string;
  /** The big figure when it is not a running countdown: "12:10", "2:10", "Now". */
  figure: string;
  /** Under the figure: "leave by", "hr free", "to leave", "leave", "booked", "ended". */
  unit: string;
  /** The compact island's figure: "12:10", "2:10h", "Now". */
  compact: string;
  /** True when the figure is a countdown to `leaveAt` that iOS runs itself. */
  countdown: boolean;
  /** When to leave for the stop, epoch ms. */
  leaveAt: number;
  /** Where the leg's bar starts: 30 min before leaving, the window the countdown covers. */
  barFrom: number;
  /** The bar's two ends, as clocks: "11:52" and "12:10". */
  fromLabel: string;
  toLabel: string;
  /** How the leg is travelled, for its symbol. Null on the first stop, which has no leg. */
  mode: TransportMode | null;
  /** Which stop this face is about; the day line's current dot. */
  stopIndex: number;
  /** Apple Maps directions to the stop, or null when the day is done. */
  directions: string | null;
  /** A file in the widgets' shared directory, or null; filled in by the caller. */
  photo: string | null;
};

export type DayActivityProps = {
  /** "Lisbon · Day 3 of 5". */
  day: string;
  stopCount: number;
  face: DayFace;
  /** The face after the next transition, drawn once iOS marks the activity stale. */
  next: DayFace | null;
};

/** The countdown leads inside this, as on Home (`IMMINENT_MINUTES`). */
const WINDOW_MINUTES = 30;

const MOVING: Record<TransportMode, string> = { walk: 'walking', bike: 'cycling', drive: 'driving', transit: 'by transit' };

/** 12:10, never zero-padded: "9:05", not "09:05". */
export function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
}
export function clockAP(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${clock(m)} ${m < 720 ? 'AM' : 'PM'}`;
}
/** 130 → "2:10", 120 → "2:00": a free stretch in the figure's own shape. */
function hoursFigure(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

type Day = {
  city: string;
  dayNumber: number;
  stops: Stop[];
  /** "Sintra": what tomorrow is, for the done face; null on the last day. */
  tomorrow: string | null;
};

/** The day at `at` minutes past midnight where the trip is; `epochAt` turns such a minute into ms. */
export function dayFace(day: Day, at: number, epochAt: (minutes: number) => number): DayFace {
  const { stops } = day;
  const state = todayState(stops, at, (i) => leaveBy(stops, i));
  if (state.kind === 'done' || state.kind === 'empty') {
    const last = dayClocks(stops).reduce<number>((m, c) => (c === null ? m : Math.max(m, c)), -1);
    const ended = last < 0 ? at : last;
    return {
      kind: 'done',
      eyebrow: `${day.city} · day ${day.dayNumber} done`,
      title: "That's the day",
      sub: [`${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`, day.tomorrow ? `tomorrow, ${day.tomorrow}` : null].filter(Boolean).join(' · '),
      figure: '',
      unit: 'ended',
      compact: '',
      countdown: false,
      leaveAt: epochAt(ended),
      barFrom: epochAt(ended),
      fromLabel: clock(ended),
      toLabel: '',
      mode: null,
      stopIndex: Math.max(0, stops.length - 1),
      directions: null,
      photo: null,
    };
  }

  const stop = stops[state.index];
  // Rolled clocks throughout: `at` can be past 1440 while a day carries over midnight.
  const stopAt = dayClocks(stops)[state.index] ?? at;
  const departure = leaveBy(stops, state.index);
  const leaveMin = leaveMinute(stops, state.index, departure) ?? stopAt;
  const booked = stop.timeFlexibility === 'FIXED';
  const legOf = dayLegs(stops).find((l) => l.toIndex === state.index) ?? null;
  const leg = legOf ? `${legOf.minutes} min ${MOVING[legOf.mode]}` : null;
  const withLeg = (text: string) => (leg ? `${text} · ${leg}` : text);

  const base = {
    eyebrow: `Next · ${clockAP(stopAt)}${booked ? ' · booked' : ''}`,
    title: stop.name,
    countdown: false,
    leaveAt: epochAt(leaveMin),
    barFrom: epochAt(leaveMin - WINDOW_MINUTES),
    fromLabel: clock(at),
    toLabel: clock(leaveMin),
    mode: legOf?.mode ?? null,
    stopIndex: state.index,
    directions: `maps://?daddr=${stop.lat},${stop.lng}`,
    photo: null,
  };
  switch (state.kind) {
    case 'late':
      return { ...base, kind: 'late', sub: `${describeGap(state.minutes)} past the departure`, figure: 'Now', unit: 'booked', compact: 'Now' };
    case 'imminent':
      return state.minutes === 0
        ? { ...base, kind: 'imminent', sub: withLeg('Leave now'), figure: 'Now', unit: 'leave', compact: 'Now' }
        : { ...base, kind: 'imminent', sub: withLeg(`Leave in ${describeGap(state.minutes)}`), figure: '', unit: 'to leave', compact: '', countdown: true };
    case 'free':
      return { ...base, kind: 'free', sub: `Free for about ${describeGap(state.minutes)}`, figure: hoursFigure(state.minutes), unit: 'hr free', compact: `${hoursFigure(state.minutes)}h` };
    case 'upcoming':
      return departure === null
        ? { ...base, kind: 'upcoming', sub: `Starts at ${clockAP(stopAt)}`, figure: clock(stopAt), unit: 'starts', compact: clock(stopAt) }
        : { ...base, kind: 'upcoming', sub: withLeg(`Leave by ${clockAP(leaveMin)}`), figure: clock(leaveMin), unit: 'leave by', compact: clock(leaveMin) };
  }
}

/**
 * The next minute the face changes after `at`: where the stop stops being free (90 min before
 * leaving), the countdown starts (30), the departure passes, or the stop starts and the next one
 * leads. Only the moments where the face really changes count. Null when nothing more happens today.
 */
export function nextChange(day: Day, at: number): number | null {
  const now = dayFace(day, at, () => 0);
  if (now.kind === 'done') return null;
  const stop = day.stops[now.stopIndex];
  const stopAt = dayClocks(day.stops)[now.stopIndex] ?? at;
  const departure = leaveBy(day.stops, now.stopIndex);
  const leaveMin = leaveMinute(day.stops, now.stopIndex, departure) ?? stopAt;
  // A booked stop skips the departure minute's "Leave now" for the late alert a minute on: with one
  // change carried ahead, the alert is the one worth having, and the countdown reaches 0:00 itself.
  const booked = stop.timeFlexibility === 'FIXED';
  const candidates = [leaveMin - 89, leaveMin - WINDOW_MINUTES, booked ? leaveMin + 1 : leaveMin, stopAt].filter((t) => t > at).sort((a, b) => a - b);
  for (const t of candidates) {
    const then = dayFace(day, t, () => 0);
    if (then.kind !== now.kind || then.stopIndex !== now.stopIndex || then.figure !== now.figure) return t;
  }
  return null;
}

/** The activity for `now` (epoch ms), with `nowMinutes` the same moment on the trip's own clock. */
export function dayActivityProps(input: Day & { dayCount: number; now: number; nowMinutes: number }): { props: DayActivityProps; staleAt: Date | null } {
  // Minutes on the trip's clock to epoch ms, from the start of the current minute.
  const minuteStart = input.now - (input.now % 60_000);
  const epochAt = (minutes: number) => minuteStart + (minutes - input.nowMinutes) * 60_000;
  const face = dayFace(input, input.nowMinutes, epochAt);
  const change = nextChange(input, input.nowMinutes);
  return {
    props: {
      day: `${input.city} · Day ${input.dayNumber} of ${input.dayCount}`,
      stopCount: input.stops.length,
      face,
      next: change === null ? null : dayFace(input, change, epochAt),
    },
    staleAt: change === null ? null : new Date(epochAt(change)),
  };
}
