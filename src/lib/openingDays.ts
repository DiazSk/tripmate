/**
 * Which weekdays a place is closed, from OSM's `opening_hours` tag.
 *
 * Its own module, importing nothing, because both sides need it: the server attaches closed days
 * to anchors (`anchorHours.ts`, through `poiDetails.ts`, which re-exports this), and the trip page's
 * map search checks a found place against the day it would join. `poiDetails.ts` reaches the
 * database through its fetch cache, so the browser could not import it from there.
 */
/** OSM `opening_hours` syntax lists the days a place is OPEN (e.g. "Tu-Su 10:00-18:00"), so the
 *  closed days are whatever it omits. Only handles the plain day-range/day-list forms; anything
 *  with conditional or holiday syntax returns null rather than a confidently wrong answer. */
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function closedDaysFromOpeningHours(openingHours: string | null): string[] | null {
  if (!openingHours) return null;
  if (openingHours.includes("24/7")) return [];
  // PH (public holidays), "off"/"closed" exceptions and comment syntax carry rules this simple
  // parser would silently get wrong.
  if (/PH|off|closed|"/i.test(openingHours)) return null;

  const open = new Set<string>();
  for (const token of openingHours.split(/[;,]/)) {
    const dayPart = token.trim().match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)/);
    if (!dayPart) continue;
    const range = dayPart[1].split(/\s*-\s*/);
    const start = DAYS.indexOf(range[0]);
    if (start === -1) continue;
    if (range.length === 1) {
      open.add(DAYS[start]);
      continue;
    }
    const end = DAYS.indexOf(range[1]);
    if (end === -1) continue;
    // Wraps across the week boundary for ranges like "Sa-Tu".
    for (let i = start; ; i = (i + 1) % DAYS.length) {
      open.add(DAYS[i]);
      if (i === end) break;
    }
  }

  if (open.size === 0) return null;
  return DAYS.filter((d) => !open.has(d));
}
