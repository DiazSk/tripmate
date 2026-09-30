import { formatDuration } from '@shared/format';
import { formatClock, parseClock } from '@shared/itinerary';
import { aboutDuration, travelLegBetween } from '@shared/travelTime';
import type { TransportMode } from '@shared/types';

import type { Stop } from '@/api/types';

/**
 * How much of a day is spent getting between its stops.
 *
 * **The legs are where a plan breaks.** Two stops an hour apart say nothing about whether the
 * hour is generous; the hop between them does. `TravelSegment` already prices one hop in the
 * gutter — this is the same arithmetic asked about the whole day, and about when you have to
 * leave to make the next stop on time.
 *
 * Priced through `travelLegBetween`, the repo's one tuned hop, so nothing here can disagree with
 * a segment in the list or a conflict from the guardrails.
 *
 * **Time, never distance.** `TravelSegment` records why: a destination is free text, and nothing
 * here knows whether the traveler thinks in miles or kilometres, so a figure in either would
 * invite a question the plan cannot answer. Minutes are also the thing somebody acts on.
 */

/** An unplaced stop sits at 0,0 — the Gulf of Guinea, not a place you walk to. */
const located = (stop: Stop) => !(stop.lat === 0 && stop.lng === 0);

const point = (stop: Stop) => ({ lat: stop.lat, lon: stop.lng });

export interface DayLeg {
  /** Index of the arriving stop; the leg runs from the one before it. */
  toIndex: number;
  mode: TransportMode;
  minutes: number;
}

/**
 * Every consecutive hop that can be priced, in order.
 *
 * A pair with an unplaced end is skipped rather than bridged to the next located stop: the
 * gutter leaves that segment empty for the same reason, and inventing a hop across a stop
 * nobody could place would put a number on a journey that is not the one being taken.
 */
export function dayLegs(stops: Stop[]): DayLeg[] {
  const legs: DayLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    if (!located(from) || !located(to)) continue;
    const leg = travelLegBetween(point(from), point(to));
    legs.push({ toIndex: i, mode: leg.mode, minutes: leg.minutes });
  }
  return legs;
}

/** Gerunds, because they follow a duration: "48 min walking", not "48 min walk". */
const MOVING: Record<TransportMode, string> = {
  walk: 'walking',
  bike: 'cycling',
  transit: 'transit',
  drive: 'driving',
};

/** At most this many modes in the summary — a third is a rounding error wearing a label. */
const MAX_MODES = 2;

/**
 * `5 stops · 48 min walking · 14 min transit`.
 *
 * The count comes first because it is what the map is already showing, and the travel after it
 * because that is the part the map cannot draw. A day nothing can be priced on says only its
 * count, which is honest: the stops are there, the journey between them is unknown.
 */
export function travelSummary(stops: Stop[]): string {
  const count = `${stops.length} stop${stops.length === 1 ? '' : 's'}`;

  const byMode = new Map<TransportMode, number>();
  for (const leg of dayLegs(stops)) {
    byMode.set(leg.mode, (byMode.get(leg.mode) ?? 0) + leg.minutes);
  }

  const parts = [...byMode.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MODES)
    .map(([mode, minutes]) => `${aboutDuration(formatDuration(minutes * 60))} ${MOVING[mode]}`);

  return [count, ...parts].join('  ·  ');
}

/**
 * When to leave the previous stop to reach this one at the time the plan gives it.
 *
 * Derived from the **arriving stop's own stated time**, not from a predicted arrival — a second
 * opinion about when you get somewhere would either agree with the plan and be noise, or
 * disagree with it and duplicate the conflict the guardrails already draw in coral. What is
 * genuinely absent from this app is the other end of that sum: the moment you have to go.
 *
 * Null whenever the sum cannot be done honestly — no previous stop, either end unplaced, an
 * unparseable clock, or a departure that falls before midnight, which `formatClock` would
 * otherwise wrap into a plausible-looking late evening.
 */
export function leaveBy(stops: Stop[], toIndex: number): string | null {
  const to = stops[toIndex];
  const from = stops[toIndex - 1];
  if (!to || !from || !located(to) || !located(from)) return null;

  const arrive = parseClock(to.time);
  if (arrive === null) return null;

  const leg = travelLegBetween(point(from), point(to));
  const depart = arrive - leg.minutes;
  return depart < 0 ? null : formatClock(depart);
}
