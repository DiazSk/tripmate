import {
  ARRIVAL_BUFFER_MIN,
  DEPARTURE_BUFFER_MIN,
  clockAfter,
  dayActiveSpan,
  dayClocks,
  formatClock,
  parseClock,
  parseDuration,
  tripSpend,
} from "./itinerary";
import { normalizeStopName } from "./placeConflicts";
import { formatDuration } from "./format";
import { legMinutes } from "./schedule";
import type {
  DayPlan,
  CheckableItinerary,
  Stop,
  StopCategory,
  TransportMode,
  TripLogistics,
  UnplacedAnchor,
} from "./types";
import { anchorKey } from "./anchors";

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
  | "required"
  | "anchors"
  | "routing"
  | "weather"
  /** A stop on a weekday its published hours say it's closed. Only from known hours. */
  | "closed"
  /** A day of an imported plan with nothing in it. */
  | "empty";

/** Looked-up door-to-door minutes for one hop, or `null` when no route was found. */
export type LegMinutesLookup = (from: Stop, to: Stop) => number | null;

export interface Guardrail {
  rule: GuardrailRule;
  /** One line, already phrased for the traveler. */
  message: string;
  /** Day this concerns, 0-based; null for trip-wide findings (budget). */
  dayIndex: number | null;
  /**
   * The stop within `dayIndex` this is about, 0-based, where one stop is to blame.
   *
   * Absent on findings that are about the day itself — its pace, its ordering, its total — and on
   * trip-wide ones. It exists so a client can draw the problem **on the row that causes it**
   * rather than only in a summary panel: a conflict read next to the stop it concerns is a
   * decision, and the same sentence in a list somewhere else is a chore.
   *
   * For a leg finding it is the **arriving** stop, not the one that overran. That is the stop
   * whose plan is now wrong, and on a booked one it is the reservation about to be missed.
   */
  stopIndex?: number;
}

/** Travel estimates are straight-line distance times a circuity factor, so they carry minutes of
 *  error in either direction. Flagging a 2-minute shortfall on a 2-minute walk is noise that
 *  teaches the traveler to ignore the warnings that matter. */
const TRAVEL_SLACK_MINUTES = 5;

/**
 * A day is only worth flagging as badly ordered when the detour is both large in absolute terms
 * and large relative to the day — BOTH, because either alone produces noise. Ten minutes is
 * nobody's problem however bad the ratio, and 25% of a long transit day can be a single
 * unavoidable crossing.
 */
const BACKTRACK_MINUTES = 20;
const BACKTRACK_FRACTION = 0.25;

/** Rain likely enough that an outdoor stop is a real risk rather than a possibility. */
const RAIN_RISK_PERCENT = 60;

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

/**
 * §12a + §12b(timing): each consecutive hop must fit in the gap the schedule leaves for it.
 *
 * When the stop being arrived at is one the traveler **booked** (`timeFlexibility: "FIXED"`), the
 * same arithmetic is reported as a `commitment` instead — §0 rank 1. That is a reclassification,
 * not a second check, and deliberately so: a missed reservation and a tight walk are the same
 * subtraction, and adding a separate booked-stop check would report one problem twice and dock two
 * health dimensions for it. What changes is the rank it is judged at and the words it is given,
 * since "only 12 min is left for it" does not tell somebody their table is gone.
 */
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
    const fit = legFit(from, to, modes, realMinutes);
    if (!fit) continue;
    const { end, nextStart, gap, needed } = fit;

    const booked = to.timeFlexibility === "FIXED";

    if (gap < 0) {
      found.push({
        rule: booked ? "commitment" : "overlap",
        dayIndex,
        stopIndex: i + 1,
        message: booked
          ? `${from.name} runs until ${fmt(end)}, past the ${fmt(nextStart)} booking at ${to.name}.`
          : `${from.name} runs until ${fmt(end)} but ${to.name} starts at ${fmt(nextStart)}, so they overlap.`,
      });
      continue;
    }
    if (needed - gap >= TRAVEL_SLACK_MINUTES) {
      found.push({
        rule: booked ? "commitment" : "travel",
        dayIndex,
        stopIndex: i + 1,
        // Names the arrival time rather than the shortfall, which is the figure somebody acts on:
        // "arrives 6:23" is a decision, "11 min short" is a puzzle.
        //
        // "the 7:00 PM booking at Den" rather than "the dinner the traveler booked": these
        // messages are read in two places — on the traveler's own screen, and by the critique
        // pass — and the third person that reads naturally to the model ("the traveler only
        // arrives at…", as `checkCommitments` writes it) reads oddly to the person it is about.
        // Naming no one at all is correct in both.
        message: booked
          ? `Leaving ${from.name} at ${fmt(end)} arrives about ${fmt(end + needed)}, after the ${fmt(nextStart)} booking at ${to.name}.`
          : `${from.name} to ${to.name} takes about ${needed} min, but only ${gap} min is left for it.`,
      });
    }
  }

  return found;
}

/** What one hop costs against the room the schedule leaves for it. */
export interface LegFit {
  /** Minutes since the day's midnight; past 1440 for a stop after midnight (`clockAfter`). */
  end: number;
  nextStart: number;
  /** Room between the two, negative when they overlap. */
  gap: number;
  /** What the hop actually takes. */
  needed: number;
  /** Minutes the gap is short by. Zero or less when the leg already fits. */
  shortfall: number;
}

/**
 * The one subtraction behind three findings — `travel`, `overlap` and `commitment` are all this
 * arithmetic, differing only in rank and wording.
 *
 * **Exported so a repair cannot disagree with the check that raised it.** `guardrailFixes`
 * offers to move a stop by exactly `shortfall`, and deriving that from the finding's prose, or
 * recomputing it beside this, is how the fix and the conflict end up telling a traveler two
 * different numbers.
 *
 * Null when either clock is unreadable, which is the same case the checks skip.
 */
export function legFit(
  from: Stop,
  to: Stop,
  modes?: TransportMode[],
  realMinutes?: LegMinutesLookup
): LegFit | null {
  const start = parseClock(from.time ?? "");
  const clock = parseClock(to.time ?? "");
  if (start === null || clock === null) return null;
  // A 1:00 AM transfer after a 6:00 PM dinner is the next morning, not seven hours before dinner:
  // read raw, it was a 1,080-minute overlap reported as "past the 1:00 AM booking".
  const nextStart = clockAfter(clock, start);

  const end = start + parseDuration(from.durationLabel ?? "");
  const gap = nextStart - end;
  // A real duration wins where one was found; an unroutable pair falls back to the estimate
  // rather than being skipped, so a missing route never silently drops the check.
  const needed = realMinutes?.(from, to) ?? legMinutes(from, to, modes);
  return { end, nextStart, gap, needed, shortfall: needed - gap };
}

/** Local re-format so a message can print a computed minute count as a clock time. */
export function fmt(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(total % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** §12c: an over-long day is only a finding when nothing in it is a sit-down break. */
function checkPace(day: DayPlan, dayIndex: number): Guardrail[] {
  const span = dayActiveSpan(day);
  if (!span || span.minutes <= LONG_DAY_MINUTES) return [];

  // **Exact, and said exactly.** This is a subtraction over two clock times already in the plan,
  // not an estimate, so it takes no hedge — an outside review read "about 11.5 hours" beside
  // "about 27 min transit" and correctly said the word had stopped meaning "this could be wrong"
  // and started meaning "a calculation happened". `formatDuration` also retires the `toFixed(1)`
  // that made the old figure genuinely approximate: 11h32m printed as "11.5", which was the one
  // reading under which the hedge was honest.
  const length = formatDuration(span.minutes * 60);
  if (day.stops.some(isBreak)) {
    // Long, but it has somewhere to sit — worth saying once, not worth flagging as a problem.
    return span.minutes > LONG_DAY_MINUTES + PACE_GRACE_WITH_BREAKS
      ? [
          {
            rule: "pace",
            dayIndex,
            message: `This day runs ${span.start} to ${span.end}: ${length}, even with breaks in it.`,
          },
        ]
      : [];
  }

  return [
    {
      rule: "pace",
      dayIndex,
      message: `This day runs ${span.start} to ${span.end}: ${length} with no meal or rest stop in it.`,
    },
  ];
}

/** Minutes spent travelling along a list of stops in the order given. */
function pathMinutes(stops: Stop[], modes?: TransportMode[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += legMinutes(stops[i - 1], stops[i], modes);
  return total;
}

/**
 * The same stops, greedily reordered nearest-first from wherever the day actually begins.
 *
 * **A yardstick, not a suggestion.** Greedy nearest-neighbour is not the optimal tour and is not
 * meant to be: it is a cheap floor that a sanely-ordered day sits close to, and a day sitting far
 * above it is one that doubles back. Offering it as *the* better route would be offering a route
 * that ignores opening hours, meal times and daylight — which is why `checkRouting` reports the
 * excess and names nothing.
 */
function nearestOrder(stops: Stop[], modes?: TransportMode[]): Stop[] {
  const remaining = stops.slice(1);
  const order = [stops[0]];
  while (remaining.length > 0) {
    const from = order[order.length - 1];
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (legMinutes(from, remaining[i], modes) < legMinutes(from, remaining[best], modes)) best = i;
    }
    order.push(remaining.splice(best, 1)[0]);
  }
  return order;
}

/**
 * How much of the day's travel is the order rather than the distance.
 *
 * **Silent on a day holding a booked stop, deliberately.** A 7pm reservation fixes where the
 * evening has to be, so the same places in "nearest order" is not an order the traveler could
 * actually take — reporting a saving they cannot have is exactly the untrustworthy advice a
 * decomposed, explainable health figure exists to avoid.
 *
 * Under four located stops there is no meaningful detour to find: three stops have one alternative
 * ordering and the first is pinned.
 */
function checkRouting(day: DayPlan, dayIndex: number, modes?: TransportMode[]): Guardrail[] {
  // Unplaced stops sit at 0,0; a leg measured to one is a leg measured to the Gulf of Guinea.
  const stops = (day.stops ?? []).filter((stop) => located(stop.lat, stop.lng));
  if (stops.length < 4) return [];
  if (stops.some((stop) => stop.timeFlexibility === "FIXED")) return [];

  const actual = pathMinutes(stops, modes);
  const best = pathMinutes(nearestOrder(stops, modes), modes);
  const excess = actual - best;
  if (excess < BACKTRACK_MINUTES || excess < best * BACKTRACK_FRACTION) return [];

  return [
    {
      rule: "routing",
      dayIndex,
      message: `This day spends about ${Math.round(excess)} min more travelling than the same places in a tighter order would.`,
    },
  ];
}

/**
 * An outdoor stop on a day the forecast says will rain.
 *
 * **Silent where the weather is `historical` rather than forecast, and that needs no branch here.**
 * `weather.ts` writes `precipitationProbability: null` on the typical-weather fallback, because
 * last year's figure for the same date is not a claim about this trip. So a day beyond the
 * forecast horizon simply has nothing to check — the house rule that an absent check beats a
 * fabricated one, already enforced at the source.
 *
 * `outdoor` is likewise only read where the model wrote it. A plan generated before the field
 * existed reports nothing rather than guessing from `category`, which cannot tell a covered market
 * from an open one.
 */
function checkWeather(day: DayPlan, dayIndex: number): Guardrail[] {
  const chance = day.weatherDetail?.precipitationProbability;
  if (chance === null || chance === undefined || chance < RAIN_RISK_PERCENT) return [];
  // `flatMap` over the indexed list rather than `filter().map()`: the index is the whole point,
  // and filtering first is exactly how it gets lost.
  return (day.stops ?? []).flatMap((stop, stopIndex) =>
    stop.outdoor === true
      ? [
          {
            rule: "weather" as const,
            dayIndex,
            stopIndex,
            message: `${stop.name} is outdoors, and rain is about ${Math.round(chance)}% likely that day.`,
          },
        ]
      : []
  );
}

/** Every finding for one day. */
export function evaluateDay(
  day: DayPlan,
  dayIndex: number,
  modes?: TransportMode[],
  realMinutes?: LegMinutesLookup
): Guardrail[] {
  return [
    ...checkLegs(day, dayIndex, modes, realMinutes),
    ...checkPace(day, dayIndex),
    ...checkRouting(day, dayIndex, modes),
    ...checkWeather(day, dayIndex),
  ];
}

/**
 * §12d: the trip's total against the stated budget. Trip-wide, so it isn't a per-day check.
 *
 * Has to agree with `BudgetBar`, which shows the same sum — two surfaces disagreeing about
 * whether you are over budget is exactly the drift the contract docblock in itinerary.ts was
 * written about.
 */
const WEEKDAY_CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Monday-first index of a calendar date, read in UTC — a local parse rolls back a day west of Greenwich. */
export function weekdayIndex(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const weekdayName = (isoDate: string): string => WEEKDAY_NAMES[weekdayIndex(isoDate)];

/** True only when the hours are known and say closed that weekday. Unknown is never closed. */
export function isClosedOn(stop: Pick<Stop, "closedDays">, isoDate: string): boolean {
  return Boolean(stop.closedDays?.includes(WEEKDAY_CODES[weekdayIndex(isoDate)]));
}

/**
 * Stops planned on a day they're closed. Deliberately not `detectConflicts`: that writes its
 * warning into the stop's `note`, which on an imported plan is the traveller's own words.
 */
export function checkClosed(itinerary: CheckableItinerary): Guardrail[] {
  return itinerary.days.flatMap((day, dayIndex) =>
    day.stops.flatMap((stop, stopIndex) =>
      isClosedOn(stop, day.date)
        ? [{ rule: "closed" as const, dayIndex, stopIndex, message: `${stop.name} is closed on ${weekdayName(day.date)}s.` }]
        : []
    )
  );
}

/**
 * Days with nothing in them, on imported plans only: `evaluateItinerary` also feeds generation's
 * critique and the benchmark scorer, which counts findings, and neither should change.
 */
export function checkEmptyDays(itinerary: CheckableItinerary): Guardrail[] {
  if (itinerary.origin !== "imported") return [];
  return itinerary.days.flatMap((day, dayIndex) =>
    day.stops.length === 0
      ? [{ rule: "empty" as const, dayIndex, message: `Nothing is planned on day ${dayIndex + 1} yet.` }]
      : []
  );
}

export function evaluateBudget(itinerary: CheckableItinerary, budget: number): Guardrail[] {
  if (!budget || budget <= 0) return [];
  const total = tripSpend(itinerary.days);
  if (total <= budget) return [];
  const over = Math.round(total - budget);
  return [
    {
      rule: "budget",
      dayIndex: null,
      message: `The trip now totals $${Math.round(total)}, $${over} over your $${budget} budget.`,
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
function checkDuplicates(itinerary: CheckableItinerary): Guardrail[] {
  const found: Guardrail[] = [];
  const seen: {
    key: string;
    lat: number;
    lng: number;
    name: string;
    category: StopCategory;
    dayIndex: number;
  }[] = [];

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
        // **Name the other one, and say where it is.** A finding reported against the later day
        // is only actionable if the reader can find the earlier stop, and neither half of the old
        // sentence located it: the proximity branch matches two *different* names and said which,
        // but not which day, while the name branch matches two *identical* names and printed the
        // same string on both sides — "Dinner in Bairro Alto is already in the trip as Dinner in
        // Bairro Alto", a sentence with no information in it.
        //
        // Each clause earns its place by saying something the reader does not already have. The
        // prior name is dropped when it is the same string, and the prior day when it is the day
        // the finding already renders under.
        const otherName = prior.name === stop.name ? "" : ` as ${prior.name}`;
        const otherDay = prior.dayIndex === dayIndex ? "" : `, on day ${prior.dayIndex + 1}`;
        found.push({
          rule: "duplicate",
          dayIndex,
          message: `${stop.name} is already in the trip${otherName}${otherDay}: the same place twice.`,
        });
      } else {
        seen.push({
          key,
          lat: stop.lat,
          lng: stop.lng,
          name: stop.name,
          category: stop.category,
          dayIndex,
        });
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
function checkCommitments(
  itinerary: CheckableItinerary,
  logistics: Partial<TripLogistics>
): Guardrail[] {
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
          message: `${stop.name} starts at ${stop.time}, but you only arrive at ${logistics.arrivalTime} and need about ${ARRIVAL_BUFFER_MIN} min for bags and the transfer in.`,
        });
      }
    }
  }

  const leaves = parseClock(logistics.departureTime ?? "");
  if (leaves !== null && lastIndex >= 0 && itinerary.days[lastIndex]) {
    // The travel time to the departure point is not known here, so this checks the processing
    // buffer alone. A plan that clears this can still be too tight once the transfer is counted —
    // §12a's travel check is what catches that half.
    //
    // The flight is read against the day's last stop the way any late stop is (`clockAfter`): a
    // 04:00 departure after a 1:00 AM airport transfer is that night's, and read as this morning's
    // it flagged every stop of the day as running past 2:00 AM.
    const stops = itinerary.days[lastIndex].stops ?? [];
    const clocks = dayClocks(stops);
    const lastStart = clocks.reduce<number | null>((last, c) => c ?? last, null);
    const mustEndBy = clockAfter(leaves, lastStart) - DEPARTURE_BUFFER_MIN;
    for (const [i, stop] of stops.entries()) {
      const start = clocks[i];
      if (start === null) continue;
      const end = start + parseDuration(stop.durationLabel ?? "");
      if (end > mustEndBy) {
        found.push({
          rule: "commitment",
          dayIndex: lastIndex,
          message: `${stop.name} runs past ${formatClock(mustEndBy)}, which is when you need to be heading for a ${logistics.departureTime} departure.`,
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
        message: `${day.lodging.name} is already paid for, so it should cost 0, not $${day.lodging.cost}.`,
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
  itinerary: CheckableItinerary,
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

/** How close a stop must be to an anchor's coordinates to count as that place, whatever it's called. */
const ANCHOR_MATCH_METRES = 150;

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const p = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lng - a.lng) * p) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export interface AnchorCoverage {
  /** `must` anchors only — a skipped `want` needs no explanation. */
  total: number;
  placed: { name: string; dayIndex: number }[];
  unplaced: UnplacedAnchor[];
  /** Neither scheduled nor explained: the model dropped it silently. */
  missing: string[];
}

/**
 * Which of the traveler's `must` places made it into the plan. Checked here, in code, because the
 * receipt is a promise to the traveler — it must never take the model's word for it.
 */
export function anchorCoverage(itinerary: CheckableItinerary): AnchorCoverage | null {
  const musts = (itinerary.anchors ?? []).filter((a) => a.priority === "must");
  if (musts.length === 0) return null;
  const explained = new Map((itinerary.unplaced ?? []).map((u) => [anchorKey(u.name), u]));
  const cov: AnchorCoverage = { total: musts.length, placed: [], unplaced: [], missing: [] };
  for (const anchor of musts) {
    const key = anchorKey(anchor.name);
    const dayIndex = itinerary.days.findIndex((day) =>
      day.stops.some(
        (s) =>
          (key && anchorKey(s.name).includes(key)) ||
          (anchor.lat !== null &&
            anchor.lng !== null &&
            metresBetween(s, { lat: anchor.lat, lng: anchor.lng }) <= ANCHOR_MATCH_METRES)
      )
    );
    if (dayIndex !== -1) cov.placed.push({ name: anchor.name, dayIndex });
    else if (explained.has(key)) cov.unplaced.push(explained.get(key)!);
    else cov.missing.push(anchor.name);
  }
  return cov;
}

export function evaluateAnchors(itinerary: CheckableItinerary): Guardrail[] {
  return (anchorCoverage(itinerary)?.missing ?? []).map((name) => ({
    rule: "anchors" as const,
    message: `${name} isn't in the plan, and the planner didn't say why.`,
    dayIndex: null,
  }));
}

/**
 * Whether a finding means the day **cannot happen as written**, as opposed to being worth reading.
 *
 * A leg that does not fit, two stops booked over each other, a reservation that will be missed:
 * those are consequences. A long day, a detour, rain over a garden, a must-see left out — all
 * worth saying, none of them impossible. The split is what lets coral mean one thing in the UI
 * (DESIGN.md's One Meaning Rule) and what lets `revisionIsNoWorse` tell a repair from a trade-off.
 */
export const isBlocking = (finding: Guardrail): boolean =>
  finding.rule === "travel" || finding.rule === "overlap" || finding.rule === "commitment";

/**
 * Is a rewritten day set safe to accept in place of the one it would replace?
 *
 * **The review pass used to be believed.** It was handed the deterministic findings, returned a
 * day set that replaced every day wholesale, and was trusted — so a model rewriting seven days to
 * fix one leg could break three others and ship, with nothing logged and nobody told. Every saved
 * trip in this app came out of its own review still carrying 3 to 16 findings.
 *
 * **Judged on blocking findings only, and that is a correction to this gate's first version.**
 * Counting *all* findings looked obviously right and was wrong, caught on the first real
 * generation it ran against: the review removed an impossible leg and shortened all three days
 * from ~13 hours to 11.5, then added the dinner day 4 was missing — which put day 4 over the pace
 * threshold as well. Total findings: 4 before, 4 after. A count cannot see that a day got ninety
 * minutes shorter, so on that yardstick a plainly better plan scored level, and one more day
 * tipping over would have had it **rejected**. Blocking findings went 1 to 0, which is the fact
 * that mattered.
 *
 * So this refuses a revision that makes the trip impossible, and otherwise lets the review trade
 * an advisory finding for a real repair — which is its job. The advisory totals come back too,
 * for the caller to log: they are the measurement of whether the pass is earning its ~150s.
 *
 * **Budget is excluded**, the same exclusion `generationRunner` already makes when handing these
 * to the critique: the budget is stated to that model separately, and cost-pinning runs on one
 * side of this comparison before the other.
 *
 * **No `realMinutes`.** Routed durations only cover the pairs the original plan contained, so a
 * revision that renames or reorders stops would fall back to estimates for its new legs and be
 * judged against a rival measured a different way. Straight-line for both is less accurate and
 * strictly fairer, and fairness is the only property this needs.
 */
export function revisionIsNoWorse(
  before: CheckableItinerary,
  after: CheckableItinerary,
  options: Parameters<typeof evaluateItinerary>[1] = {}
): {
  ok: boolean;
  blockingBefore: number;
  blockingAfter: number;
  totalBefore: number;
  totalAfter: number;
} {
  const findings = (itinerary: CheckableItinerary) =>
    evaluateItinerary(itinerary, { ...options, budget: undefined }).filter(
      (g) => g.rule !== "budget"
    );
  const [b, a] = [findings(before), findings(after)];
  const blockingBefore = b.filter(isBlocking).length;
  const blockingAfter = a.filter(isBlocking).length;
  return {
    ok: blockingAfter <= blockingBefore,
    blockingBefore,
    blockingAfter,
    totalBefore: b.length,
    totalAfter: a.length,
  };
}

/**
 * Everything wrong with the plan as it currently stands.
 *
 * Returns findings for the whole trip so a stop dragged off day 1 onto day 3 reports what it did
 * to day 3 as well — the day the traveler is no longer looking at is exactly where an unnoticed
 * problem would sit.
 */
export function evaluateItinerary(
  itinerary: CheckableItinerary,
  options: {
    budget?: number;
    modes?: TransportMode[];
    realMinutes?: LegMinutesLookup;
    /**
     * What the traveler already booked. Absent means not asked — every check inside is skipped
     * rather than defaulting to a boundary.
     *
     * `Partial` rather than `TripLogistics`, because the two clients spell "not stated"
     * differently and both are right about their own wire: this server normalizes every field to
     * `null`, and the React Native wizard omits the key. Every read inside is `?? ""`, which
     * already treats them identically — so the declaration is widened to match the code rather
     * than either client made to lie.
     */
    logistics?: Partial<TripLogistics> | null;
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
  // `checkDuplicates` and `evaluateAnchors` need no option, so every existing caller gains them —
  // a duplicate or an unexplained missing anchor is a defect whether the model wrote it or an edit
  // introduced it.
  return [
    ...perDay,
    ...checkClosed(itinerary),
    ...checkEmptyDays(itinerary),
    ...checkDuplicates(itinerary),
    ...commitments,
    ...required,
    ...evaluateAnchors(itinerary),
    ...budget,
  ];
}
