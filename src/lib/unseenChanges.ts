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
