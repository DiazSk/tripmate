import { dayActiveSpan, parseClock, parseDuration, tripSpend } from "./itinerary";
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
 * on a Tuesday, no. The model keeps the ones that need knowledge (§12b hours), and this file never
 * guesses at them — an absent check is better than a fabricated one.
 *
 * Rules mirrored: §12a travel feasibility, §12b time overlaps only, §12c pace, §12d budget.
 * Keep this file and SKILL.md §12 in step — if a threshold moves in one, move it in the other.
 */

export type GuardrailRule = "travel" | "overlap" | "pace" | "budget";

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
function checkLegs(day: DayPlan, dayIndex: number, modes?: TransportMode[]): Guardrail[] {
  const found: Guardrail[] = [];

  for (let i = 0; i < day.stops.length - 1; i++) {
    const from = day.stops[i];
    const to = day.stops[i + 1];
    const start = parseClock(from.time ?? "");
    const nextStart = parseClock(to.time ?? "");
    if (start === null || nextStart === null) continue;

    const end = start + parseDuration(from.durationLabel ?? "");
    const gap = nextStart - end;
    const needed = legMinutes(from, to, modes);

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
  modes?: TransportMode[]
): Guardrail[] {
  return [...checkLegs(day, dayIndex, modes), ...checkPace(day, dayIndex)];
}

/** §12d: the trip's total against the stated budget. Trip-wide, so it isn't a per-day check. */
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

/**
 * Everything wrong with the plan as it currently stands.
 *
 * Returns findings for the whole trip so a stop dragged off day 1 onto day 3 reports what it did
 * to day 3 as well — the day the traveler is no longer looking at is exactly where an unnoticed
 * problem would sit.
 */
export function evaluateItinerary(
  itinerary: Itinerary,
  options: { budget?: number; modes?: TransportMode[] } = {}
): Guardrail[] {
  const perDay = itinerary.days.flatMap((day, i) => evaluateDay(day, i, options.modes));
  const budget = options.budget ? evaluateBudget(itinerary, options.budget) : [];
  return [...perDay, ...budget];
}
