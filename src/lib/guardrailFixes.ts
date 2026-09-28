import { fmt, legFit } from "./guardrails";
import { parseClock } from "./itinerary";
import type { Guardrail } from "./guardrails";
import type { CheckableItinerary, DayPlan, Stop } from "./types";

/**
 * The repairs for a leg that does not fit — computed, not asked for.
 *
 * "Fix this" used to seed the chat composer with a sentence and wait for the traveler to press
 * Send, which spent a model call and a minute of waiting on a problem that is arithmetic: a hop
 * needs more minutes than the schedule leaves for it, and there are exactly two ways to find
 * them without changing what the day contains. Move the arrival later, or set off earlier.
 *
 * **A third option — replace the stop — is deliberately not here.** That is a judgement about
 * places, which is what Ask is for; this module only offers what it can work out and be right
 * about. The chat route stays as the escape hatch beside these.
 *
 * **Nothing booked ever moves.** A `FIXED` stop is the promise the whole feature rests on, so a
 * repair that would shift one is not offered at all rather than offered and then refused.
 *
 * **And no repair may make any other leg of the day tighter than it already was.** Pulling a
 * stop earlier buys room after it by taking room before it, which can quietly break the leg
 * behind. Every candidate is re-measured across the whole day before it is offered, so
 * accepting one can never trade a named conflict for an unnamed one.
 */

export interface Repair {
  /** What it does, in the traveler's words, naming the clock time it produces. */
  label: string;
  /** The plan with it done. Feeds the same diff the chat's change preview uses. */
  next: CheckableItinerary;
}

/** Repairs land on a clock a person would say. A 7-minute shortfall becomes a 10-minute move. */
const STEP = 5;
const roundUp = (minutes: number) => Math.ceil(minutes / STEP) * STEP;

/** The rules that are all one subtraction, and so all repairable the same two ways. */
const REPAIRABLE = new Set<Guardrail["rule"]>(["travel", "overlap", "commitment"]);

const booked = (stop: Stop) => stop.timeFlexibility === "FIXED";

/** Every leg's shortfall, in order. The yardstick a candidate is measured against. */
function shortfalls(stops: Stop[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    out.push(legFit(stops[i], stops[i + 1])?.shortfall ?? 0);
  }
  return out;
}

/** Same day, same stops, the named ones re-clocked. */
function reclock(
  itinerary: CheckableItinerary,
  dayIndex: number,
  shift: (stop: Stop, index: number) => number
): CheckableItinerary {
  return {
    ...itinerary,
    days: itinerary.days.map((day, d) =>
      d !== dayIndex
        ? day
        : {
            ...day,
            stops: day.stops.map((stop, i) => {
              const by = shift(stop, i);
              if (by === 0) return stop;
              // A stop with no readable clock is left exactly as it was: there is nothing to
              // add minutes to, and writing one would invent a time nobody set.
              const at = parseClock(stop.time ?? "");
              return at === null ? stop : { ...stop, time: fmt(at + by) };
            }),
          }
    ),
  };
}

/**
 * Offered only when the candidate closes the leg it was raised for and leaves every other leg
 * of that day no tighter than it found it.
 */
function acceptable(before: number[], after: number[], leg: number): boolean {
  if (after.length !== before.length) return false;
  if ((after[leg] ?? 0) > 0) return false;
  return after.every((s, i) => s <= before[i]);
}

export function repairsFor(itinerary: CheckableItinerary, finding: Guardrail): Repair[] {
  if (!REPAIRABLE.has(finding.rule)) return [];
  if (finding.dayIndex === null || finding.stopIndex === undefined) return [];

  const day: DayPlan | undefined = itinerary.days[finding.dayIndex];
  const arriving = finding.stopIndex;
  const leaving = arriving - 1;
  if (!day || leaving < 0 || arriving >= day.stops.length) return [];

  const fit = legFit(day.stops[leaving], day.stops[arriving]);
  if (!fit || fit.shortfall <= 0) return [];

  const by = roundUp(fit.shortfall);
  const before = shortfalls(day.stops);
  const repairs: Repair[] = [];

  // Later: the arriving stop and everything after it slide, so every gap past this one is
  // preserved exactly rather than being eaten one leg at a time.
  const slides = day.stops.slice(arriving);
  if (!slides.some(booked)) {
    const next = reclock(itinerary, finding.dayIndex, (_s, i) => (i >= arriving ? by : 0));
    if (acceptable(before, shortfalls(next.days[finding.dayIndex].stops), leaving)) {
      const rest = slides.length > 1 ? " and the rest of the day" : "";
      repairs.push({
        // Same shape as the "earlier" label below — verb, what moves, how far, which way, then
        // the clock it lands on. The two are read side by side and compared, and a reader who has
        // to re-parse the second sentence's grammar is spending that attention on the wrong thing.
        label: `Push ${day.stops[arriving].name}${rest} ${by} min later, to ${fmt(fit.nextStart + by)}`,
        next,
      });
    }
  }

  // Earlier: only the stop being left moves. It buys the same minutes from the gap in front of
  // it, which is why `acceptable` re-measures the leg before it rather than assuming.
  if (!booked(day.stops[leaving])) {
    const next = reclock(itinerary, finding.dayIndex, (_s, i) => (i === leaving ? -by : 0));
    if (acceptable(before, shortfalls(next.days[finding.dayIndex].stops), leaving)) {
      const start = parseClock(day.stops[leaving].time ?? "");
      repairs.push({
        label: `Start ${day.stops[leaving].name} ${by} min earlier${
          start === null ? "" : `, at ${fmt(start - by)}`
        }`,
        next,
      });
    }
  }

  return repairs;
}
