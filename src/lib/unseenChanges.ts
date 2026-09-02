/**
 * Which days a chat turn changed that the traveler did not watch it change.
 *
 * A trip-scoped chat routinely edits days that are nowhere on screen: ask about day eight and
 * the knock-on lands on days two and three. The reply says so, then scrolls away, and the plan
 * itself carries no record — so those days get a dot on their tab until they are visited.
 *
 * Pure, and separate from the components, because the off-by-one is the whole risk: the route
 * reports **1-based** day numbers (they are shown to people) and every tab, marker and colour in
 * the app is keyed on the **0-based** index into `Itinerary.days[]`. Converting in a component,
 * twice, in two files, is how one of them ends up marking the wrong day with total confidence.
 */

import type { DayPlan } from "./types";

/**
 * @param daysModified 1-based day numbers, as `/api/trip-edit` returns them.
 * @param viewing the 0-based day currently on screen, or null when no day is singled out.
 * @param alreadyUnseen 0-based days still carrying a dot from earlier turns.
 * @returns 0-based days that should carry a dot, sorted, without duplicates.
 */
export function markUnseenDays(
  daysModified: number[],
  viewing: number | null,
  alreadyUnseen: number[] = []
): number[] {
  const next = new Set(alreadyUnseen);
  for (const oneBased of daysModified) {
    const index = oneBased - 1;
    // A day that does not exist is dropped rather than marked: the dot is a promise that there
    // is something to go and look at, and a tab that isn't there cannot keep it.
    if (!Number.isInteger(index) || index < 0) continue;
    // The day being watched is not news. Its changes happened in front of the traveler, and a
    // dot on the tab they are already on reads as an unread badge on an open message.
    if (index === viewing) continue;
    next.add(index);
  }
  return [...next].sort((a, b) => a - b);
}

/** Drop a day's dot once it has been looked at. */
export function clearUnseenDay(unseen: number[], day: number): number[] {
  return unseen.filter((d) => d !== day);
}

/**
 * A day reduced to the fields a traveler would call a change, in a fixed order.
 *
 * The point is the fixed order. The two day sets being compared are two separate model responses,
 * so `JSON.stringify` on the raw objects compares key *order* as much as content — the same day
 * with its keys emitted differently reads as edited. An explicit tuple removes that entirely, and
 * removes the server-added fields with it: `weatherDetail` is attached from the forecast lookup
 * rather than authored, and comparing it would flag every day whenever that object was rebuilt.
 *
 * `summary` IS compared, deliberately. It went missing once — the critique prompt's shape omitted
 * the field the generate prompt asked for, so a compliant revision erased every narrative — and
 * the fix for that lives upstream in `carryOverDaySummaries`, which refills it before this ever
 * runs. With the field guaranteed present, a genuinely rewritten narrative is a real change and
 * should carry a dot; excluding it here would only paper over a regression of that bug.
 */
function dayFingerprint(day: DayPlan | undefined): string {
  if (!day) return "";
  return JSON.stringify([
    day.date,
    day.weather,
    day.summary ?? "",
    day.title ?? "",
    day.lodging ? [day.lodging.name, day.lodging.cost, day.lodging.note] : null,
    (day.stops ?? []).map((s) => [
      s.name,
      s.lat,
      s.lng,
      s.cost,
      s.time,
      s.durationLabel,
      s.category,
      s.why ?? "",
      s.note,
    ]),
  ]);
}

/**
 * Which days the background critique actually rewrote, as **1-based** day numbers — the form
 * `markUnseenDays` takes, since they are the numbers shown to people.
 *
 * Compared position by position rather than by date, because that is what the dot means: the tab
 * in slot N now shows something different from what was there. A day the revision drops entirely
 * is not reported — there is no tab left to carry a dot.
 */
export function changedDayNumbers(before: DayPlan[] | null, after: DayPlan[]): number[] {
  if (!before) return [];
  return after.flatMap((day, i) =>
    dayFingerprint(before[i]) === dayFingerprint(day) ? [] : [i + 1]
  );
}
