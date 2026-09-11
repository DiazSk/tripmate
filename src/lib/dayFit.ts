// Relative, not the `@/lib` alias. `scripts/ts-resolve.mjs` retries a failed *relative* specifier
// as `.ts`, and resolves nothing else — so a module that needs to be reachable from a `.test.mjs`
// (this one is, and its geometry is exactly the kind that should be) must not go through the
// alias. See the note in CLAUDE.md on what the hook does and does not fix.
import { metresBetween } from "./peekRange";

/**
 * Which day of a trip a newly-found place belongs to, decided from coordinates alone.
 *
 * **No model call, deliberately.** A day is already a shape on the map — the stops the planner
 * grouped together — and "which of these shapes does this point belong to" is a question geometry
 * answers exactly, in microseconds, offline, and identically every time it is asked. Handing it to
 * an LLM would trade all four of those for an opinion. The suggestion this returns is also only a
 * *suggestion*: the day list stays fully selectable, so being wrong costs a click rather than a
 * wrong plan.
 *
 * The scoring is **distance to the day's centroid, measured in units of that day's own radius**,
 * and the normalisation is the whole point. Raw distance to a centroid systematically prefers
 * sprawling days: a day that crosses a region has a centroid that is "near" everything, while a
 * tight morning pocket three streets over is judged far away by the same metre count that would be
 * nothing to the sprawling one. Dividing by the day's own spread asks the question that actually
 * matters — *is this point the kind of distance from this day that this day's own stops are?* — so
 * a café 900m from a pocket that fits inside 1.1km reads as a worse fit than one 3.8km into a day
 * that already spans 12km, which is the right answer and the opposite of what raw distance says.
 *
 * Note the deliberate asymmetry with `peekRange.ts`, which solves a superficially similar problem
 * (how far back to pull for a stop to read against its neighbours) with nearest-neighbour rather
 * than centroid distance. That one is about what a *camera* has to contain; this one is about what
 * a *day* is, and a day is its whole shape rather than its closest corner.
 */

/** A day reduced to what the fit needs: its index in the trip and the coordinates it contains. */
export interface DayShape {
  day: number;
  stops: { lat: number; lng: number }[];
}

export interface DayFit {
  /** Index into the trip's days, matching `DayShape.day`. */
  day: number;
  /** Metres from the point to the day's centroid. Reported for the UI's "1.2km from Day 3". */
  distanceM: number;
  /** `distanceM` in units of the day's own radius — what days are actually ranked on. Lower is a
   *  better fit. `Infinity` for a day with no stops, which is never recommended over one with. */
  score: number;
}

/**
 * The floor on a day's radius, in metres.
 *
 * A day with one stop has a radius of zero, and a day whose stops sit on one block has one close
 * enough to it that dividing by it sends the score to infinity for everything — a single-stop day
 * would then never be recommended, and a compact day only for a point almost exactly on top of it.
 * 400m is roughly a walkable block-and-a-half, which is the distance at which two places genuinely
 * read as "the same part of town", so it is the smallest spread worth treating as a real one.
 */
export const MIN_DAY_RADIUS_M = 400;

/** Days whose centroid is further than this are not offered as a suggestion at all. A place in
 *  another city is not a "fit" for any day, and recommending the least-bad one would be a
 *  confident wrong answer where no answer is the honest one. */
export const MAX_FIT_DISTANCE_M = 60_000;

/** The mean of a day's stops. The centre of the shape, not a stop on it. */
function centroidOf(stops: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (stops.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const stop of stops) {
    lat += stop.lat;
    lng += stop.lng;
  }
  return { lat: lat / stops.length, lng: lng / stops.length };
}

/**
 * How far this day's stops sit from their own centre — the day's "size" for scoring purposes.
 *
 * The **mean** distance rather than the max, so one outlier does not inflate the whole day's
 * tolerance. A Kyoto day with Fushimi Inari 12km out from four stops in Gion should not thereby
 * become a day that welcomes anything within 12km; its mean radius stays around 3km, which is a
 * fair description of what that day mostly is.
 */
function radiusOf(
  stops: { lat: number; lng: number }[],
  centre: { lat: number; lng: number }
): number {
  if (stops.length === 0) return MIN_DAY_RADIUS_M;
  const total = stops.reduce((sum, stop) => sum + metresBetween(centre, stop), 0);
  return Math.max(MIN_DAY_RADIUS_M, total / stops.length);
}

/**
 * Score every day for a candidate point, best fit first.
 *
 * Days with no stops score `Infinity` and sort last, but are still returned: the picker lists every
 * day whether or not it has anything in it yet, and an empty day is a perfectly reasonable place to
 * put the first thing — it just is not something geometry can *recommend*.
 */
export function rankDaysForPlace(
  point: { lat: number; lng: number },
  days: DayShape[]
): DayFit[] {
  return days
    .map((shape) => {
      const centre = centroidOf(shape.stops);
      if (!centre) return { day: shape.day, distanceM: Number.POSITIVE_INFINITY, score: Number.POSITIVE_INFINITY };
      const distanceM = metresBetween(centre, point);
      return { day: shape.day, distanceM, score: distanceM / radiusOf(shape.stops, centre) };
    })
    .sort((a, b) => a.score - b.score || a.day - b.day);
}

/**
 * The one day to recommend, or null when geometry has nothing useful to say.
 *
 * Null in three cases, all of them "no honest answer" rather than "no answer computed": no days at
 * all, no day with any stops to form a shape from, and every day further off than
 * `MAX_FIT_DISTANCE_M`. The caller shows the day list without a recommendation rather than
 * pointing at a day it cannot justify.
 */
export function suggestDayForPlace(
  point: { lat: number; lng: number },
  days: DayShape[]
): DayFit | null {
  const best = rankDaysForPlace(point, days)[0];
  if (!best || !Number.isFinite(best.score) || best.distanceM > MAX_FIT_DISTANCE_M) return null;
  return best;
}
