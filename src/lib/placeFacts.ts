import { closedDaysFromOpeningHours, fetchPoiOsmTags } from "./poiDetails";

/** Real, looked-up facts about one named place. Every field is independently nullable: a place
 *  can have hours but no admission, or accessibility but no rating, and a caller must be able to
 *  act on whichever it got.
 *
 *  Sourced from OSM/Overpass (`poiDetails.ts`), which is free and needs no API key but only
 *  publishes opening hours as tags. `admissionUsd`, `accessibility`, `bookAhead`, `rating`, and
 *  `crowdByDay` are therefore permanently `null`/`false`/`[]` — there is no free source for any of
 *  them — and are kept in the shape only because `placeConflicts.ts` still reads them defensively. */
export interface PlaceFacts {
  /** Lowercase weekday → "Closed", from OSM's `opening_hours` tag via `closedDaysFromOpeningHours`.
   *  Can only ever hold confirmed-closed days; every other weekday is simply absent, meaning
   *  "presumed open, hours unknown" — never a clock-time string like "9 AM–6 PM". */
  hoursByDay: Record<string, string> | null;
  admissionUsd: number | null;
  accessibility: string[];
  /** Always `false` — no free data source exists for a "book ahead" signal. */
  bookAhead: boolean;
  rating: number | null;
  /** The listing's own title, kept so the caller can reject a confident mismatch. */
  title: string | null;
  /** Always `null` — no free source exists for crowd/popular-times data. */
  crowdByDay: Record<string, { time: string; busyness: number | null }[]> | null;
}

/** OSM only tells us which days are CLOSED, never open/close clock times — see
 *  closedDaysFromOpeningHours's own doc: it deliberately won't parse PH/off/quoted syntax. So
 *  every entry here is "Closed"; every other weekday is omitted, meaning "presumed open, hours
 *  unknown" rather than a guessed time range. Accepted capability loss: detectConflicts's
 *  publishedHours time-of-day check in placeConflicts.ts (the one needing an actual "9–11 AM,
 *  12–3 PM" string) will never fire under this path — not a bug to fix later. */
const OSM_DAY_TO_WEEKDAY: Record<string, string> = {
  Mo: "monday", Tu: "tuesday", We: "wednesday", Th: "thursday",
  Fr: "friday", Sa: "saturday", Su: "sunday",
};

export function mapClosedDaysToHoursByDay(closedDays: string[] | null): Record<string, string> | null {
  if (closedDays === null || closedDays.length === 0) return null;
  const out: Record<string, string> = {};
  for (const day of closedDays) {
    const weekday = OSM_DAY_TO_WEEKDAY[day];
    if (weekday) out[weekday] = "Closed";
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Look up one named stop by its own coordinates. OSM matching is coordinate-radius-based rather
 * than geocoded-by-name, so the caller supplies the stop's own lat/lon instead of a destination
 * string. Resolves `null` on any failure, per the house convention — the caller leaves the
 * model's own values in place.
 */
export async function fetchPlaceFacts(name: string, lat: number, lon: number): Promise<PlaceFacts | null> {
  const tagsByName = await fetchPoiOsmTags([{ name, lat, lon }]);
  if (tagsByName === null) return null; // network/HTTP failure
  const tags = tagsByName[name];
  if (!tags) return null; // queried fine, no OSM match — same null contract as before

  const hoursByDay = mapClosedDaysToHoursByDay(closedDaysFromOpeningHours(tags.openingHours));
  if (hoursByDay === null) return null; // nothing usable at all — same "empty payload" contract

  return { hoursByDay, admissionUsd: null, accessibility: [], bookAhead: false, rating: null, title: null, crowdByDay: null };
}
