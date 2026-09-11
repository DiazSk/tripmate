// Relative, not the `@/lib` alias — this module is reached from a `.test.mjs` and
// `scripts/ts-resolve.mjs` only retries relative specifiers. Same reason `dayFit.ts` says so.
import { parseClockTime, type TimeOfDay } from "./timeOfDay";
import type { Stop } from "./types";

/**
 * Where in a day a newly-found place goes, and what time it gets.
 *
 * `dayFit.ts` answers *which day* a searched place belongs to, from geometry. This answers the
 * other half: given that day and a part of it the traveler picked, **which position in the running
 * order, and what clock time** — without moving anything already in the plan.
 *
 * **No model call, and for the same reasons `dayFit` gives.** A day already has times in it. "What
 * time is free between these two stops" is arithmetic, and arithmetic is instant, offline, and the
 * same answer every time it is asked.
 *
 * **What replaced what.** A place found in search used to be appended to the end of the day with no
 * time at all, on the argument that a searched place has no time of its own and guessing one would
 * put a claim in the plan that nobody made. That argument was right about the guess and wrong about
 * the remedy: the traveler *does* know whether they want the café in the morning, they were simply
 * never asked, and "end of the day, no time" is itself a claim — it drops a breakfast spot after
 * dinner. So the traveler picks the part of the day, and this slots it there. The only thing still
 * left blank is `durationLabel`, which nobody has told us and this does not invent.
 */

/**
 * The windows a new stop may be *assigned* into, which are deliberately narrower than the bands
 * `timeOfDay()` reads an existing stop back out of.
 *
 * Classification has to cover the whole clock — a 5am flight is somebody's morning and a 1am bar is
 * somebody's evening, and `timeOfDay` labels both. Assignment does not: nothing this app puts into
 * a day unprompted belongs at 5am or at midnight. So mornings start at eight, evenings stop at ten,
 * and the anchor is where that part of the day actually happens.
 *
 * **The invariant these must preserve**: any time assigned from a window classifies back into the
 * same slot under `timeOfDay`. The stop list groups by that function, so a stop the traveler filed
 * under Morning appearing beneath an "AFTERNOON" heading would be the feature contradicting itself
 * on screen. Every window here sits strictly inside its classification band; `planSlot` clamps to
 * the window even when the day is too full to honour it, precisely so this cannot break.
 */
export const SLOT_WINDOWS: Record<TimeOfDay, { start: number; end: number; anchor: number }> = {
  Morning: { start: 8 * 60, end: 12 * 60, anchor: 10 * 60 },
  Afternoon: { start: 12 * 60, end: 17 * 60, anchor: 14 * 60 + 30 },
  Evening: { start: 17 * 60, end: 22 * 60, anchor: 19 * 60 },
};

/** Minutes left between one stop ending and the next beginning. A city block, a coffee, a wrong
 *  turn — not a routed travel time, which this has no coordinates to compute and no business
 *  pretending to. */
export const TRANSIT_BUFFER_MIN = 15;

/**
 * How long a stop with nothing said about it is assumed to take, for spacing purposes only.
 *
 * Never written into the plan: `durationLabel` stays empty on a searched place, because an hour is
 * this module's working assumption and not a fact anyone supplied. It exists so the *next* stop
 * after it is not scheduled on top of it.
 */
export const DEFAULT_VISIT_MIN = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Reading a day
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `"1 hour"`, `"45 min"`, `"1.5 hours"`, `"2h 30m"` → minutes, or null when it is not a duration.
 *
 * The model writes this field as free text and nothing enforces a shape, which is the same reason
 * `parseClockTime` is as forgiving as it is. Null rather than a guess: a stop whose length is
 * unknown is spaced with `DEFAULT_VISIT_MIN`, and pretending to have read "all afternoon" as a
 * number would be worse than admitting it did not parse.
 */
export function parseDurationLabel(label: string | undefined | null): number | null {
  if (!label) return null;
  const text = label.toLowerCase();
  let total = 0;
  let matched = false;
  for (const [, value, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    total += /^h/.test(unit) ? n * 60 : n;
    matched = true;
  }
  if (!matched) return null;
  const rounded = Math.round(total);
  // A day is the ceiling. "3 days" in this field is a data error, not a visit, and letting it
  // through would push every following stop off the end of the clock.
  return rounded > 0 && rounded <= 24 * 60 ? rounded : null;
}

/** Minutes since midnight → `"2:30 PM"`. The format every other time in the plan is written in. */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(m / 60);
  const minute = m % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** A stop reduced to what slotting needs. Anything whose clock time will not parse is `null` and
 *  is treated as not bounding anything — see `planSlot`. */
function anchorsOf(stops: Stop[]): { index: number; start: number; end: number }[] {
  return stops.flatMap((stop, index) => {
    const start = parseClockTime(stop.time);
    if (start === null) return [];
    return [{ index, start, end: start + (parseDurationLabel(stop.durationLabel) ?? DEFAULT_VISIT_MIN) }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggesting a slot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Words in a place's own name that outrank its category.
 *
 * A category is a coarse bucket — "restaurant" covers a breakfast counter and a tasting menu — and
 * the name is very often the finer signal. Matched on word boundaries so "Sunset Boulevard Diner"
 * is not filed as an evening venue for containing "set", and checked before the category table
 * because a "Night Market" is an evening thing whatever OSM tagged it as.
 *
 * Ordered: the first list that matches wins, so a "Sunrise Rooftop Bar" reads as evening (rooftop,
 * from the later list) only if nothing in the morning list hit first. Keep the lists short — this
 * is a nudge on a default the traveler can override in one click, not a classifier.
 */
const NAME_HINTS: { slot: TimeOfDay; words: string[] }[] = [
  {
    slot: "Morning",
    words: ["breakfast", "brunch", "bakery", "bakehouse", "coffee", "espresso", "patisserie", "sunrise"],
  },
  {
    slot: "Evening",
    words: ["night", "nightclub", "club", "rooftop", "sunset", "cocktail", "wine", "jazz", "tavern", "pub", "brewery", "dinner"],
  },
];

/**
 * What time of day this place probably wants, as the picker's default.
 *
 * A *suggestion*, exactly like `dayFit`'s: all three slots stay one click away, so being wrong
 * costs a click rather than a wrong plan. It reads the place alone and deliberately not the day —
 * "when is this place good" and "when does this day have room" are different questions, and the
 * second is `planSlot`'s, which will fit the choice in wherever the traveler puts it.
 *
 * The category defaults are about when a place is *reliably open and at its best* rather than when
 * it is conceivable: cafés are a morning thing and shops mostly do not open early, bars often do
 * not open before evening at all, and a restaurant searched for while planning is far more often
 * dinner than lunch. `place` — the free-text category, and the largest bucket — gets Afternoon,
 * which is the band that is never closed and never absurd.
 */
export function suggestTimeOfDay(place: { category?: string; name?: string }): TimeOfDay {
  const name = (place.name ?? "").toLowerCase();
  for (const hint of NAME_HINTS) {
    if (hint.words.some((word) => new RegExp(`\\b${word}\\b`).test(name))) return hint.slot;
  }
  switch (place.category) {
    case "cafe":
      return "Morning";
    case "bar":
    case "restaurant":
      return "Evening";
    default:
      return "Afternoon";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Placing it
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotPlan {
  /** Where the new stop goes in the day's `stops` array. Nothing already there moves. */
  index: number;
  /** The clock time to give it, in the plan's own format. */
  time: string;
  /**
   * True when the chosen part of the day had no clear gap and the stop was fitted in anyway.
   *
   * Surfaced rather than swallowed: it is the difference between "we found it a slot" and "your
   * afternoon is now shoulder to shoulder", and the traveler is the one who can decide whether
   * that matters.
   */
  tight: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Where in the day a new stop goes, given the part of the day the traveler chose.
 *
 * **Nothing already in the plan moves.** The new stop is inserted at the end of its chosen part of
 * the day, after the last stop that starts before that window closes and before the first that
 * starts after it. That is the predictable answer, and predictable matters more here than optimal:
 * a traveler who adds three cafés to a morning gets them in the order they added them, rather than
 * watching the plan re-sort itself around a hunt for the widest gap.
 *
 * The time is then the window's anchor, pulled into whatever room actually exists between the
 * neighbours — so a morning that already runs to 11:30 puts the new stop at 11:45 rather than
 * insisting on ten o'clock and scheduling it on top of something.
 *
 * **Stops whose time will not parse bound nothing.** They keep their place in the order and are
 * stepped over, which is the same treatment `groupStopsByTimeOfDay` gives them. A day with no
 * parseable times at all gets the new stop appended at its window's anchor, which is the only
 * honest answer available.
 */
export function planSlot(
  stops: Stop[],
  slot: TimeOfDay,
  /** Minutes the new stop is assumed to take, for spacing only. */
  visitMinutes: number = DEFAULT_VISIT_MIN
): SlotPlan {
  const window = SLOT_WINDOWS[slot];
  const anchors = anchorsOf(stops);

  // The last stop that begins before this window closes, and the first that begins at or after it.
  // Read in array order — the plan's own running order — rather than sorted by time, because a day
  // whose times are out of order is a day the traveler is looking at, and re-deriving an order it
  // does not have would move things behind their back.
  const before = [...anchors].reverse().find((a) => a.start < window.end);
  const after = anchors.find((a) => a.start >= window.end && (!before || a.index > before.index));

  const index = before ? before.index + 1 : (after?.index ?? stops.length);

  const earliest = before ? Math.max(window.start, before.end + TRANSIT_BUFFER_MIN) : window.start;
  /**
   * The latest the stop may *start*, and note that `visitMinutes` is measured against the next
   * stop rather than against the end of the window.
   *
   * Requiring the whole visit to fit inside the window was the first version and it is wrong about
   * what a window is: a coffee at half past eleven is a morning coffee even though you leave at
   * half past twelve. Measured against a real case — a day whose only morning stop was a two-hour
   * market from nine — that rule declared an eleven-fifteen slot impossible and reported a
   * perfectly ordinary morning as full. The window bounds when a stop *starts*, which is also the
   * only thing `timeOfDay` reads. What the visit length has to clear is the next stop.
   */
  const latest = Math.min(
    window.end - 1,
    after ? after.start - visitMinutes - TRANSIT_BUFFER_MIN : Number.POSITIVE_INFINITY
  );

  let tight = false;
  let time: number;
  if (earliest <= latest) {
    time = clamp(window.anchor, earliest, latest);
  } else {
    // No clean gap. Sit directly after the previous stop rather than at the anchor, and never past
    // where the next one starts — then clamp back inside the window, because a stop filed under
    // Morning must still read as morning in the list. The cost of that clamp is a time that can
    // coincide with a neighbour's on a genuinely full day, which is what `tight` reports.
    tight = true;
    time = before ? before.end : window.start;
    if (after) time = Math.min(time, after.start);
  }

  // Floored to a five-minute grid, because a plan is written in times a person would say. The
  // clamped tight case is what forced this: the last minute of the afternoon window is 16:59, and
  // "4:59 PM" in an itinerary reads as a bug rather than as a tight fit. Floor rather than round,
  // so the result can never drift *past* `latest` and into the next stop; the two or three minutes
  // it can take off the transit buffer are noise against a buffer that is itself a guess.
  const grid = Math.floor(clamp(time, window.start, window.end - 1) / 5) * 5;
  return { index, time: formatClock(Math.max(grid, window.start)), tight };
}
