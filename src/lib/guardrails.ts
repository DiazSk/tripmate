import { dayActiveSpan, parseClock, parseDuration, tripSpend } from "./itinerary";
import { normalizeStopName } from "./placeConflicts";
import { legMinutes } from "./schedule";
import type { DayPlan, Itinerary, Stop, TransportMode } from "./types";

/**
 * The §12 guardrails, evaluated in code.
 *
 * Deliberately a second implementation of rules the skill already states in prose, and the
 * duplication is the point: the model applies them when it is the one changing the plan, and this
 * applies them when the *traveler* is — a hand-drag has no model call to hang a warning off, and
 * waiting 70-140s to be told a leg doesn't fit would make dragging useless.
 *
 * Scope is narrower than the skill's on purpose. Only the checks that are decidable from data
 * already in the itinerary live here: distances and clock arithmetic, yes; whether a venue is open
 * on a Tuesday, no — that needs a looked-up fact, so it lives in `placeConflicts.ts`, which runs
 * server-side during generation where the lookup happens. This file still never guesses at it: an
 * absent check is better than a fabricated one.
 *
 * `realMinutes` lets the generation path substitute looked-up door-to-door durations for the
 * straight-line estimate. UI callers omit it and behave exactly as before.
 *
 * Rules mirrored: §12a travel feasibility, §12b time overlaps only, §12c pace, §12d budget.
 * Keep this file and SKILL.md §12 in step — if a threshold moves in one, move it in the other.
 */

export type GuardrailRule =
  | "travel"
  | "overlap"
  | "pace"
  | "budget"
  | "duplicate"
  | "commitment"
  | "required"
  | "party-budget";

/** Looked-up door-to-door minutes for one hop, or `null` when no route was found. */
export type LegMinutesLookup = (from: Stop, to: Stop) => number | null;

export interface Guardrail {
  rule: GuardrailRule;
  /** One line, already phrased for the traveler. */
  message: string;
  /** Day this concerns, 0-based; null for trip-wide findings (budget). */
  dayIndex: number | null;
}

/** Travel estimates are straight-line distance times a circuity factor, so they carry minutes of
 *  error in either direction. Flagging a 2-minute shortfall on a 2-minute walk is noise that
 *  teaches the traveler to ignore the warnings that matter. */
const TRAVEL_SLACK_MINUTES = 5;

/** §12c: the point past which a day needs a real break in it, not just a note about one. */
const LONG_DAY_MINUTES = 9 * 60;
/** A stop that counts as sitting down — a meal or a deliberate pause of this long or more. */
const BREAK_MINUTES = 30;
/** How far past the pace limit a day with real breaks in it may run before it is still worth
 *  mentioning. A day with lunch and a cafe in it isn't a problem at 10 hours; at 11 it is a long
 *  day whatever is in it. */
const PACE_GRACE_WITH_BREAKS = 2 * 60;

function isBreak(stop: Stop): boolean {
  return stop.category === "food" || parseDuration(stop.durationLabel ?? "") >= BREAK_MINUTES;
}

/** §12a + §12b(timing): each consecutive hop must fit in the gap the schedule leaves for it. */
function checkLegs(
  day: DayPlan,
  dayIndex: number,
  modes?: TransportMode[],
  realMinutes?: LegMinutesLookup
): Guardrail[] {
  const found: Guardrail[] = [];

  for (let i = 0; i < day.stops.length - 1; i++) {
    const from = day.stops[i];
    const to = day.stops[i + 1];
    const start = parseClock(from.time ?? "");
    const nextStart = parseClock(to.time ?? "");
    if (start === null || nextStart === null) continue;

    const end = start + parseDuration(from.durationLabel ?? "");
    const gap = nextStart - end;
    // A real duration wins where one was found; an unroutable pair falls back to the estimate
    // rather than being skipped, so a missing route never silently drops the check.
    const needed = realMinutes?.(from, to) ?? legMinutes(from, to, modes);

    if (gap < 0) {
      found.push({
        rule: "overlap",
        dayIndex,
        message: `${from.name} runs until ${fmt(end)} but ${to.name} starts at ${fmt(nextStart)} — they overlap.`,
      });
      continue;
    }
    if (needed - gap >= TRAVEL_SLACK_MINUTES) {
      found.push({
        rule: "travel",
        dayIndex,
        message: `${from.name} to ${to.name} takes about ${needed} min, but only ${gap} min is left for it.`,
      });
    }
  }

  return found;
}

/** Local re-format so a message can print a computed minute count as a clock time. */
function fmt(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(total % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** §12c: an over-long day is only a finding when nothing in it is a sit-down break. */
function checkPace(day: DayPlan, dayIndex: number): Guardrail[] {
  const span = dayActiveSpan(day);
  if (!span || span.minutes <= LONG_DAY_MINUTES) return [];

  const hours = (span.minutes / 60).toFixed(1).replace(/\.0$/, "");
  if (day.stops.some(isBreak)) {
    // Long, but it has somewhere to sit — worth saying once, not worth flagging as a problem.
    return span.minutes > LONG_DAY_MINUTES + PACE_GRACE_WITH_BREAKS
      ? [
          {
            rule: "pace",
            dayIndex,
            message: `This day runs ${span.start} to ${span.end} — about ${hours} hours, even with breaks in it.`,
          },
        ]
      : [];
  }

  return [
    {
      rule: "pace",
      dayIndex,
      message: `This day runs ${span.start} to ${span.end} — about ${hours} hours with no meal or rest stop in it.`,
    },
  ];
}

/** Every finding for one day. */
export function evaluateDay(
  day: DayPlan,
  dayIndex: number,
  modes?: TransportMode[],
  realMinutes?: LegMinutesLookup
): Guardrail[] {
  return [...checkLegs(day, dayIndex, modes, realMinutes), ...checkPace(day, dayIndex)];
}

/**
 * §12d: the trip's total against the stated budget. Trip-wide, so it isn't a per-day check.
 *
 * Has to agree with `BudgetBar`, which shows the same sum — two surfaces disagreeing about
 * whether you are over budget is exactly the drift the contract docblock in itinerary.ts was
 * written about.
 */
export function evaluateBudget(itinerary: Itinerary, budget: number): Guardrail[] {
  if (!budget || budget <= 0) return [];
  const total = tripSpend(itinerary.days);
  if (total <= budget) return [];
  const over = Math.round(total - budget);
  return [
    {
      rule: "budget",
      dayIndex: null,
      message: `The trip now totals $${Math.round(total)} — $${over} over your $${budget} budget.`,
    },
  ];
}

/** Two stops this close, under names that normalize the same, are one place written twice rather
 *  than two neighbours. Degrees, not metres: ~0.0015° is roughly 150m at any latitude this app
 *  plans trips at, and a haversine here would be precision the comparison does not need. */
const DUPLICATE_DEGREES = 0.0015;

/**
 * §14e: the same place scheduled twice across the trip.
 *
 * Trip-wide rather than per-day, because reading a plan day by day is exactly how a repeat
 * survives. Lodging is exempt — §4c *requires* the same stay on every night in one city, so
 * flagging it would report the rule working as a fault.
 *
 * Matches on the normalized name OR on proximity, not both: "Sensō-ji" and "Asakusa Kannon Temple"
 * share coordinates and no letters, while two branches of one chain share a name and no
 * coordinates. Either alone is enough to be worth a look.
 */
function checkDuplicates(itinerary: Itinerary): Guardrail[] {
  const found: Guardrail[] = [];
  const seen: { key: string; lat: number; lng: number; name: string }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    for (const stop of day.stops ?? []) {
      const key = normalizeStopName(stop.name);
      if (!key) continue;
      const prior = seen.find(
        (s) =>
          s.key === key ||
          (Math.abs(s.lat - stop.lat) < DUPLICATE_DEGREES &&
            Math.abs(s.lng - stop.lng) < DUPLICATE_DEGREES)
      );
      if (prior) {
        found.push({
          rule: "duplicate",
          dayIndex,
          message: `${stop.name} is already in the trip as ${prior.name} — the same place twice.`,
        });
      } else {
        seen.push({ key, lat: stop.lat, lng: stop.lng, name: stop.name });
      }
    }
  });

  return found;
}

/**
 * Everything wrong with the plan as it currently stands.
 *
 * Returns findings for the whole trip so a stop dragged off day 1 onto day 3 reports what it did
 * to day 3 as well — the day the traveler is no longer looking at is exactly where an unnoticed
 * problem would sit.
 */
export function evaluateItinerary(
  itinerary: Itinerary,
  options: { budget?: number; modes?: TransportMode[]; realMinutes?: LegMinutesLookup } = {}
): Guardrail[] {
  const perDay = itinerary.days.flatMap((day, i) =>
    evaluateDay(day, i, options.modes, options.realMinutes)
  );
  const budget = options.budget ? evaluateBudget(itinerary, options.budget) : [];
  // Needs no option, so every existing caller gains it — a duplicate is a defect whether the
  // model wrote it or an edit introduced it.
  return [...perDay, ...checkDuplicates(itinerary), ...budget];
}
