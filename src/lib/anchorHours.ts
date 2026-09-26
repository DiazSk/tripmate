import { closedDaysFromOpeningHours, fetchPoiOsmTags } from "./poiDetails";
import type { Anchor, PoiOsmTags } from "./types";

/** On the critical path before the plan exists, so far tighter than the 45s batch default. It
 *  overlaps the context and sketch waits in `runGeneration`, so it costs nothing unless Overpass is
 *  slower than both. 20s, not the spec's 15s: the live Kyoto+Rome lookup took 11.7-15.2s, so 15s
 *  would drop the hours on an ordinary day. */
export const ANCHOR_HOURS_BUDGET_MS = 20_000;

type FetchTags = (
  pois: { name: string; lat: number; lon: number }[],
  timeoutMs: number
) => Promise<Record<string, PoiOsmTags> | null>;

/** Hours onto the anchors OSM knows. An anchor with no hours is returned as-is, so its prompt line
 *  reads exactly as it did before this existed. */
export function attachHours(anchors: Anchor[], tags: Record<string, PoiOsmTags> | null): Anchor[] {
  if (!tags) return anchors;
  return anchors.map((a) => {
    const hours = tags[a.name]?.openingHours;
    return hours ? { ...a, openingHours: hours, closedDays: closedDaysFromOpeningHours(hours) } : a;
  });
}

/**
 * The traveller's places with their real opening hours, before generation — the planner is told
 * "schedule every MUST place at a time it is open" and, until this, never when that was.
 *
 * Fail-soft and bounded: a lookup that errors, returns null or outlasts `budgetMs` leaves the
 * anchors unchanged. `askOverpass` may try several mirrors, so the race is the real cap rather
 * than the timeout it is also handed.
 */
export async function fetchAnchorHours(
  anchors: Anchor[],
  fetchTags: FetchTags = fetchPoiOsmTags,
  budgetMs: number = ANCHOR_HOURS_BUDGET_MS
): Promise<Anchor[]> {
  const located = anchors
    .filter((a) => a.lat !== null && a.lng !== null)
    .map((a) => ({ name: a.name, lat: a.lat as number, lon: a.lng as number }));
  if (located.length === 0) return anchors;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    const tags = await Promise.race([fetchTags(located, budgetMs).catch(() => null), deadline]);
    // Fail-soft must not mean silent: a plan written without its places' hours reads exactly like
    // one where OSM had none, and the 2026-09-26 Kyoto run was only caught by reading the prompt.
    if (tags === null) {
      console.warn(`[itinerary] anchor hours unavailable — lookup failed or passed its ${budgetMs}ms budget`);
    }
    return attachHours(anchors, tags);
  } finally {
    clearTimeout(timer);
  }
}
