import {
  ARRIVAL_BUFFER_MIN,
  DEPARTURE_BUFFER_MIN,
  dayActiveSpan,
  formatClock,
  parseClock,
  parseDuration,
  tripSpend,
} from "./itinerary";
import { normalizeStopName } from "./placeConflicts";
import { legMinutes } from "./schedule";
import type { DayPlan, Itinerary, Stop, StopCategory, TransportMode, TripLogistics } from "./types";

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
 * Rules mirrored: §12a travel feasibility, §12b time overlaps only, §12c pace, §12d budget,
 * §14e duplicates, §0 rank 1 commitments, §0 rank 4 must-dos and exclusions.
 *
 * Keep this file in step with SKILL.md and with the four prompt builders that state the same
 * rules in prose — `lodgingPrompt.ts` (the budget ceiling), `travelerProfilePrompt.ts` (the
 * arrival and departure buffers), `itineraryPrompt.ts` (the precedence order and the critique
 * checklist) and `editPrompt.ts` (minimal change). A threshold now lives in five files, not two;
 * moving it in one is how the model and the checker start disagreeing.
 */

export type GuardrailRule =
  | "travel"
  | "overlap"
  | "pace"
  | "budget"
  | "duplicate"
  | "commitment"
  | "required";

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

/** `Stop.lat`/`lng` are typed `number`, so "unlocated" here is not null — it is 0,0. That is the
 *  coordinate `STOP_SHAPE` ships in the template (`"lat":0.0,"lng":0.0`), the one a model copying
 *  the shape writes, and the one `normalizeDays` passes through untouched while it drops
 *  non-finite values. Two unrelated stops both parked there are not the same place. Mirrors
 *  `scoreDuplicates`'s "an unlocated stop falls back to name matching alone". */
function located(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

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
 *
 * The proximity branch is skipped for `food` and `transit` stops, because for those two
 * categories sharing coordinates is by design, not by accident. §3b has an area-level food stop
 * carry the neighborhood's own lat/lng rather than a specific restaurant's — "Dinner around Pike
 * Place Market" and "Lunch near Pike Place Market" are two different meals that are supposed to
 * land on the same point, and flagging that as a repeat would report the rule the skill states
 * working as a fault. A transit leg to a station and the leg back from it are the same coordinate
 * on purpose for the same reason. Name matching still applies to both categories unchanged — two
 * dinners at the literally same restaurant, or the same transit leg logged twice, are still caught.
 *
 * An unlocated stop is skipped by the proximity branch too, for the reason `located` gives.
 */
function checkDuplicates(itinerary: Itinerary): Guardrail[] {
  const found: Guardrail[] = [];
  const seen: { key: string; lat: number; lng: number; name: string; category: StopCategory }[] = [];

  itinerary.days.forEach((day, dayIndex) => {
    for (const stop of day.stops ?? []) {
      const key = normalizeStopName(stop.name);
      if (!key) continue;
      const coLocationExpected = stop.category === "food" || stop.category === "transit";
      const prior = seen.find(
        (s) =>
          s.key === key ||
          (!coLocationExpected &&
            s.category !== "food" &&
            s.category !== "transit" &&
            located(stop.lat, stop.lng) &&
            located(s.lat, s.lng) &&
            Math.abs(s.lat - stop.lat) < DUPLICATE_DEGREES &&
            Math.abs(s.lng - stop.lng) < DUPLICATE_DEGREES)
      );
      if (prior) {
        found.push({
          rule: "duplicate",
          dayIndex,
          message: `${stop.name} is already in the trip as ${prior.name} — the same place twice.`,
        });
      } else {
        seen.push({ key, lat: stop.lat, lng: stop.lng, name: stop.name, category: stop.category });
      }
    }
  });

  return found;
}

/**
 * §0 rank 1: what the traveler already committed to, which no plan may cross.
 *
 * Three things, all silent failures otherwise. A stop before the arrival buffer clears is a stop
 * they are still at baggage reclaim for. A stop still running inside the departure buffer is a
 * missed flight. A booked stay priced again double-counts money already spent and distorts what
 * is left.
 *
 * Every check is skipped when its field is absent — "not stated" is a real state and must not read
 * as a boundary of midnight.
 */
function checkCommitments(itinerary: Itinerary, logistics: TripLogistics): Guardrail[] {
  const found: Guardrail[] = [];
  const lastIndex = itinerary.days.length - 1;

  const landed = parseClock(logistics.arrivalTime ?? "");
  if (landed !== null && itinerary.days[0]) {
    const clears = landed + ARRIVAL_BUFFER_MIN;
    for (const stop of itinerary.days[0].stops ?? []) {
      const start = parseClock(stop.time ?? "");
      if (start !== null && start < clears) {
        found.push({
          rule: "commitment",
          dayIndex: 0,
          message: `${stop.name} starts at ${stop.time}, but the traveler only arrives at ${logistics.arrivalTime} and needs about ${ARRIVAL_BUFFER_MIN} min for bags and the transfer in.`,
        });
      }
    }
  }

  const leaves = parseClock(logistics.departureTime ?? "");
  if (leaves !== null && lastIndex >= 0 && itinerary.days[lastIndex]) {
    // The travel time to the departure point is not known here, so this checks the processing
    // buffer alone. A plan that clears this can still be too tight once the transfer is counted —
    // §12a's travel check is what catches that half.
    const mustEndBy = leaves - DEPARTURE_BUFFER_MIN;
    for (const stop of itinerary.days[lastIndex].stops ?? []) {
      const start = parseClock(stop.time ?? "");
      if (start === null) continue;
      const end = start + parseDuration(stop.durationLabel ?? "");
      if (end > mustEndBy) {
        found.push({
          rule: "commitment",
          dayIndex: lastIndex,
          message: `${stop.name} runs past ${formatClock(mustEndBy)}, which is when the traveler needs to be heading for a ${logistics.departureTime} departure.`,
        });
      }
    }
  }

  // `stayBooked` names ONE stay, so only the nights actually spent in it may be flagged. Matching
  // on the name and not merely on "a stay is booked" is what keeps a multi-city trip's other,
  // correctly-priced hotels silent — flagging those would tell the critique pass to zero out a
  // real cost.
  //
  // Containment in either direction, on the normalized form: the traveler types free text
  // ("Hotel Ronda Sant Pere (already paid)") and the model writes a tidied name ("Hotel Ronda
  // Sant Pere"), and neither is reliably the prefix of the other. An empty normalized key is
  // dropped rather than matched — `"".includes()` is true of everything, which would restore the
  // bug in its widest form.
  const booked = normalizeStopName(logistics.stayBooked ?? "");
  if (booked) {
    itinerary.days.forEach((day, dayIndex) => {
      if (!day.lodging || day.lodging.cost <= 0) return;
      const name = normalizeStopName(day.lodging.name);
      if (!name || (!booked.includes(name) && !name.includes(booked))) return;
      found.push({
        rule: "commitment",
        dayIndex,
        message: `${day.lodging.name} is already paid for — it should cost 0, not $${day.lodging.cost}.`,
      });
    });
  }

  return found;
}

/**
 * §0 rank 4: what the traveler named outright.
 *
 * A must-include is not an interest tag. "I like museums" is a preference the plan weighs; "I have
 * to see the Louvre" is a requirement, and a plan missing it has failed however good the rest is.
 * Reported trip-wide (`dayIndex: null`) because the fix is "put it somewhere", not "fix day 3".
 *
 * **The two directions match differently, and the asymmetry is the point.** Both run on
 * `normalizeStopName`'s output, so the model's capitalisation and punctuation drift is absorbed
 * the way `placeConflicts` absorbs it. But a must-do is typically a *prefix* of a longer real name
 * — "Louvre" has to match "Louvre Museum" — so it matches as a substring. An exclusion is a whole
 * word, and a bare substring test makes `avoid: ["bar"]` fire on every stop in Barcelona. A check
 * that cries wolf teaches everyone to ignore the channel it feeds, so exclusions match on word
 * boundaries: the normalized form is lowercase alphanumerics separated by single spaces, so
 * padding both sides with a space is the whole of the boundary test, and it still matches a
 * multi-word exclusion as a contiguous run of whole words.
 */
function checkRequired(
  itinerary: Itinerary,
  mustInclude: string[],
  avoid: string[]
): Guardrail[] {
  const found: Guardrail[] = [];
  const names = itinerary.days.flatMap((d) => (d.stops ?? []).map((s) => normalizeStopName(s.name)));

  for (const want of mustInclude) {
    const key = normalizeStopName(want);
    if (!key) continue;
    if (!names.some((n) => n.includes(key))) {
      found.push({
        rule: "required",
        dayIndex: null,
        message: `${want} was asked for but is not in the plan.`,
      });
    }
  }

  for (const unwanted of avoid) {
    const key = normalizeStopName(unwanted);
    if (!key) continue;
    if (names.some((n) => ` ${n} `.includes(` ${key} `))) {
      found.push({
        rule: "required",
        dayIndex: null,
        message: `${unwanted} was excluded but something in the plan matches it.`,
      });
    }
  }

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
  options: {
    budget?: number;
    modes?: TransportMode[];
    realMinutes?: LegMinutesLookup;
    /** What the traveler already booked. Absent means not asked — every check inside is skipped
     *  rather than defaulting to a boundary. */
    logistics?: TripLogistics | null;
    /** Places the traveler named outright. Absent means none were named, not none matter. */
    mustInclude?: string[];
    avoid?: string[];
  } = {}
): Guardrail[] {
  const perDay = itinerary.days.flatMap((day, i) =>
    evaluateDay(day, i, options.modes, options.realMinutes)
  );
  const budget = options.budget ? evaluateBudget(itinerary, options.budget) : [];
  const commitments = options.logistics ? checkCommitments(itinerary, options.logistics) : [];
  const required =
    options.mustInclude?.length || options.avoid?.length
      ? checkRequired(itinerary, options.mustInclude ?? [], options.avoid ?? [])
      : [];
  // `checkDuplicates` needs no option, so every existing caller gains it — a duplicate is a defect
  // whether the model wrote it or an edit introduced it.
  return [
    ...perDay,
    ...checkDuplicates(itinerary),
    ...commitments,
    ...required,
    ...budget,
  ];
}
