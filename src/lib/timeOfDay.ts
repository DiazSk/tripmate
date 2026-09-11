// `import type`, not a value import. Node erases the former and keeps the latter, so a plain
// `import { Stop }` of an interface throws "does not provide an export named 'Stop'" the moment a
// .test.mjs reaches this module — the exact failure CLAUDE.md records against generationRunner.
import type { Stop } from "./types";

/**
 * The parts of a day a stop list is chunked by, in the order they occur.
 *
 * Three, and a fourth was built and cut on measurement. A separate "Night" from 9pm reads well in
 * the abstract — a 6:30pm dinner and a midnight bar are not the same evening — but run against
 * this app's own output it manufactures groups of one: across the four days of the Mumbai plan it
 * produced 4 headings over 6 stops, 4 over 5, and 4 over 5, so the headings nearly outnumbered the
 * rows they were organising and each "group" was a single stop under its own rule. Folding it into
 * Evening gives 2-3 groups of 1-3 stops on the same data, which is chunking rather than confetti.
 *
 * The cost, stated: a 1am stop is labelled "Evening". That is the colloquial reading anyway (it is
 * still the same night out), and every row carries its own clock time regardless. Restoring the
 * split is a one-line change here plus its boundary below.
 */
export type TimeOfDay = "Morning" | "Afternoon" | "Evening";

export const TIME_OF_DAY_ORDER: TimeOfDay[] = ["Morning", "Afternoon", "Evening"];

/**
 * Minutes since midnight, or `null` if this is not a time.
 *
 * The model is asked for a clock time and generally sends `"1:00 PM"`, but nothing enforces that
 * — the same reason `normalizeDays` exists — so this takes 24-hour (`"13:00"`), 12-hour with a
 * meridiem in any case or spacing (`"1:00 PM"`, `"1:00pm"`, `"1 PM"`), and returns `null` for
 * anything else rather than guessing. A `null` is a stop that stays where it is; see `groupStops`.
 *
 * `12 AM` is midnight and `12 PM` is noon — the one case where the 12-hour clock does not simply
 * add twelve, and the one this would otherwise get exactly backwards.
 */
export function parseClockTime(time: string | undefined | null): number | null {
  if (!time) return null;
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*$/i.exec(time);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.[0].toLowerCase();

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "p") hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

/**
 * Which part of the day a minute-of-day falls in.
 *
 * Boundaries are the ordinary English ones rather than even quarters: morning opens at 5am,
 * afternoon starts at noon by definition, and evening at 5pm, which is where this plan's dinners
 * start landing. Evening runs to 5am — it is the bucket that wraps past midnight, which is why
 * it is the fallthrough rather than a range of its own.
 */
export function timeOfDay(minutesSinceMidnight: number): TimeOfDay {
  const m = ((minutesSinceMidnight % 1440) + 1440) % 1440;
  if (m >= 5 * 60 && m < 12 * 60) return "Morning";
  if (m >= 12 * 60 && m < 17 * 60) return "Afternoon";
  return "Evening";
}

export interface StopGroup {
  /** `null` when not one stop in the day carried a readable time. That is one group holding
   *  everything, drawn with no heading — a heading of "Morning" over a day we know nothing about
   *  the timing of would be inventing a fact, and the system's own rule is not to render a label
   *  for a value that isn't there. */
  label: TimeOfDay | null;
  /** The stops in this group, each carrying the index it had in the day's own `stops` array —
   *  which is the index the map camera, Story mode and the hover highlight all speak in. */
  stops: { stop: Stop; index: number }[];
}

/**
 * Chunks a day's stops into consecutive parts of the day.
 *
 * **Order is never changed.** This walks the list as given and starts a new group only when the
 * label changes, so a plan that (rightly or not) puts a 9am stop after a 3pm one produces
 * `Afternoon → Morning` rather than being silently re-sorted behind the traveler's back. The
 * itinerary's order is the model's decision and, after the arrange board, sometimes the
 * traveler's; this is a heading, not a sort.
 *
 * A stop with no readable time joins the group in progress rather than forming an "Unscheduled"
 * bucket of its own — it keeps the list in its authored order, and a lone unlabelled stop between
 * two afternoon ones is an afternoon stop. Leading untimed stops open a group with the label of
 * the first stop that does have one, so nothing is filed under a guess.
 */
export function groupStopsByTimeOfDay(stops: Stop[]): StopGroup[] {
  const labels = stops.map((stop) => {
    const minutes = parseClockTime(stop.time);
    return minutes === null ? null : timeOfDay(minutes);
  });

  // Leading untimed stops have no group in progress to join, so they borrow the first real label
  // in the list. With no timed stop anywhere, everything lands in one unlabelled group and the
  // caller renders no headings at all.
  const firstKnown = labels.find((l) => l !== null) ?? null;

  const groups: StopGroup[] = [];
  let current: TimeOfDay | null = firstKnown;
  stops.forEach((stop, index) => {
    const label = labels[index] ?? current;
    current = label;
    const last = groups[groups.length - 1];
    // `label` is null only when the whole day is untimed, and then it is null for every stop —
    // so this comparison collects them into the single unlabelled group rather than starting a
    // fresh one per stop.
    if (last && last.label === label) last.stops.push({ stop, index });
    else groups.push({ label, stops: [{ stop, index }] });
  });
  return groups;
}
