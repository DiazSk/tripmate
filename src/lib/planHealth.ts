import { evaluateItinerary, type Guardrail, type GuardrailRule } from "./guardrails";
import { dayActiveSpan, parseClock } from "./itinerary";
import type { CheckableItinerary, DayPlan, TransportMode, TripLogistics } from "./types";

/**
 * The plan's health, decomposed into the things it is made of.
 *
 * **Not a score the model produces, and not one anybody tunes.** Every figure here is arithmetic
 * over `evaluateItinerary`'s findings — the same findings the trip screen prints in full beside
 * this — so the only honest answer to "why isn't this 100?" is a list the traveler can read. That
 * constraint is what the whole surface is for: a single opaque number would be a grade, and a
 * grade is something you argue with rather than act on.
 *
 * Pure, and it opens no connection. It runs on the phone and in the browser from the same module
 * for the same reason the guardrails do: two clients disagreeing about whether a plan is sound is
 * worse than neither showing it.
 */

export type HealthKey =
  | "schedule"
  | "routing"
  | "budget"
  | "weather"
  | "reservations"
  | "load"
  | "requests";

export interface HealthDimension {
  key: HealthKey;
  /** Already cased for display — this is the only place these are named. */
  label: string;
  /**
   * 0-100, or **null when this plan carries nothing to check**.
   *
   * The null is the important half. A plan whose stops have no opening-hours data, or whose days
   * are past the forecast horizon, has not *passed* those checks — nobody ran them. Scoring that
   * 100 would be the one thing a diagnostic panel must never do, and it is also how an average
   * quietly inflates: five real dimensions and two fabricated hundreds is a different number.
   */
  score: number | null;
  /** Exactly the findings that cost this dimension its points, in the order they were found. */
  findings: Guardrail[];
}

export interface PlanHealth {
  /** The mean of the measured dimensions, floored. Null when none of them could be measured. */
  score: number | null;
  /** All seven, always, measured or not — a dimension that vanishes when it has nothing to say
   *  is a dimension the reader cannot tell from one that passed. */
  dimensions: HealthDimension[];
}

/**
 * What one finding costs its dimension.
 *
 * Uniform across every rule on purpose. A weighted table would be a judgement about which defects
 * matter more, made by nobody in particular and checkable by no one — and the entire claim this
 * figure makes is that its arithmetic is visible. Twelve findings in one dimension floor it at 0,
 * which is the right shape: past a dozen problems the exact number has stopped meaning anything.
 */
const PENALTY = 8;

/** Which dimension each guardrail rule lands in. Exhaustive over `GuardrailRule` by type, so a
 *  new rule cannot be added without deciding where it belongs. */
const DIMENSION_OF: Record<GuardrailRule, HealthKey> = {
  travel: "schedule",
  overlap: "schedule",
  // A place scheduled twice is not a routing defect — it books the same hours twice over.
  duplicate: "schedule",
  routing: "routing",
  budget: "budget",
  weather: "weather",
  commitment: "reservations",
  pace: "load",
  required: "requests",
  anchors: "requests",
  // A closed door decides whether the day can happen as planned, which is what Schedule asks.
  closed: "schedule",
  // An empty day is the bottom of the same scale an overpacked one tops.
  empty: "load",
};

const LABELS: Record<HealthKey, string> = {
  schedule: "Schedule",
  routing: "Routing",
  budget: "Budget",
  weather: "Weather",
  reservations: "Reservations",
  load: "Day load",
  requests: "Your requests",
};

/** The order they read in. Roughly "can this day happen at all" down to "is it what you asked
 *  for" — a reader scanning for a red line should meet the unsurvivable ones first. */
const ORDER: HealthKey[] = [
  "schedule",
  "reservations",
  "budget",
  "load",
  "routing",
  "weather",
  "requests",
];

/** A day the clock can be read off at all — two timed stops in a row is what `checkLegs` needs. */
function hasTimedLeg(day: DayPlan): boolean {
  const stops = day.stops ?? [];
  for (let i = 0; i < stops.length - 1; i++) {
    if (parseClock(stops[i].time ?? "") !== null && parseClock(stops[i + 1].time ?? "") !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Whether each dimension has anything to measure in this plan.
 *
 * **These mirror the gates inside the checks themselves and must move with them.** That
 * duplication is deliberate and is the same bargain `guardrails.ts` already strikes with
 * `SKILL.md`: the check decides whether to speak, and this decides whether silence meant "fine"
 * or "nobody looked". Collapsing them would mean running every check twice to find out.
 */
function measurable(
  itinerary: CheckableItinerary,
  options: {
    budget?: number;
    logistics?: Partial<TripLogistics> | null;
    mustInclude?: string[];
    avoid?: string[];
  }
): Record<HealthKey, boolean> {
  const days = itinerary.days ?? [];
  const stops = days.flatMap((day) => day.stops ?? []);
  return {
    schedule: days.some(hasTimedLeg),
    // `checkRouting`'s own gate: four located stops and no booked one pinning the order.
    routing: days.some(
      (day) =>
        (day.stops ?? []).filter((s) => !(s.lat === 0 && s.lng === 0)).length >= 4 &&
        !(day.stops ?? []).some((s) => s.timeFlexibility === "FIXED")
    ),
    budget: (options.budget ?? 0) > 0,
    // BOTH halves, because either alone checks nothing: a forecast with no stop marked
    // indoor/outdoor, or `outdoor` flags on days past the forecast horizon.
    weather:
      days.some((day) => day.weatherDetail?.precipitationProbability != null) &&
      stops.some((stop) => stop.outdoor !== undefined),
    reservations:
      Object.values(options.logistics ?? {}).some(Boolean) ||
      stops.some((stop) => stop.timeFlexibility === "FIXED"),
    load: days.some((day) => dayActiveSpan(day) !== null),
    requests:
      (options.mustInclude?.length ?? 0) > 0 ||
      (options.avoid?.length ?? 0) > 0 ||
      (itinerary.anchors?.length ?? 0) > 0,
  };
}

export function planHealth(
  itinerary: CheckableItinerary,
  options: {
    budget?: number;
    modes?: TransportMode[];
    /** What the traveler already booked. Absent means not asked, and every check inside is
     *  skipped rather than defaulting to a boundary — same contract as `evaluateItinerary`. */
    logistics?: Partial<TripLogistics> | null;
    mustInclude?: string[];
    avoid?: string[];
  } = {}
): PlanHealth {
  const findings = evaluateItinerary(itinerary, options);
  const can = measurable(itinerary, options);

  const dimensions = ORDER.map((key): HealthDimension => {
    const mine = findings.filter((finding) => DIMENSION_OF[finding.rule] === key);
    return {
      key,
      label: LABELS[key],
      // A finding is proof the check ran, so it measures the dimension whatever the predicate
      // thought — the predicate only ever has to be right about *silence*.
      score: can[key] || mine.length > 0 ? Math.max(0, 100 - mine.length * PENALTY) : null,
      findings: mine,
    };
  });

  const measured = dimensions.filter((d): d is HealthDimension & { score: number } => d.score !== null);
  const score = measured.length
    ? Math.floor(measured.reduce((sum, d) => sum + d.score, 0) / measured.length)
    : null;

  return { score, dimensions };
}
