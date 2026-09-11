import { getFetchCache, saveFetchCache } from "./db";

/**
 * Read-through cache for third-party API answers.
 *
 * **Why this exists.** Almost every non-LLM fact in this app comes from a free public API, and the
 * app re-asked for the same answers on every page load: one destination cost 4 Overpass round
 * trips (1 highways + 3 city-context) per view, and a trip page's first paint fired 5-9
 * `/api/place-photo` requests, each of which is 1-4 outbound Wikipedia calls. All of it is
 * fail-soft, so none of it broke — it just silently produced a map with no highways, no city
 * outline and no photographs, and said nothing.
 *
 * The free OSM Overpass instances make that concrete: they rate-limit by IP, so re-asking is
 * itself what causes the refusals. Measured 2026-09-06, `overpass-api.de` was refusing connections
 * outright while its mirrors answered in under 1.4s; later the same day all three were timing out
 * on a 30km highways query.
 *
 * ## The contract
 *
 * A fetcher returns `T` for "here is the answer" and **`null` for "I could not ask"**. That is
 * this repo's existing fail-soft convention (see `overpass.ts`, `holidays.ts`, `poiDetails.ts`),
 * and leaning on it is what keeps this wrapper to one rule instead of a pile of options:
 *
 * > **A `null` is never written.**
 *
 * The wrapper cannot judge whether `{roads: [], water: []}` is a real answer or a refusal wearing
 * a 200 — only the module that built it can. So that judgement stays at the call site, as one
 * expression (`segments.length ? segments : null`), exactly as `exportMapData.ts` already does it.
 *
 * **Watch for callers that have already thrown the distinction away.** Several functions here
 * return `[]` or `{}` on failure, which would cache an outage as a fact and freeze it for the
 * whole TTL — "this city has no neighbouring towns", permanently. Restore the `null` before
 * wrapping anything.
 *
 * ## Stale-if-error
 *
 * When the fetcher fails and an expired row exists, **the expired row is returned**. That makes
 * the TTL a refresh hint rather than a cliff, and it is the difference between this being a speed
 * optimisation and being the thing that keeps a map on screen while all three Overpass mirrors are
 * refusing. It is also why there is no sweep: an expired row is not garbage, it is the fallback.
 *
 * Freshness is compared in JS, never in SQL — see the note on `getFetchCache` in `db.ts`.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | null>,
  /** Injectable clock, matching `staleDraftCutoff(now, …)`, so a test can age a row without waiting. */
  now: number = Date.now()
): Promise<T | null> {
  const row = readRow<T>(key);

  if (row && now - row.writtenAt < ttlMs) return row.value;

  const fresh = await fetcher();
  if (fresh !== null && fresh !== undefined) {
    try {
      saveFetchCache(key, JSON.stringify(fresh));
    } catch {
      // A cache write failing must never cost the caller its answer.
    }
    return fresh;
  }

  // The fetcher could not answer. A stale copy beats nothing at all.
  return row ? row.value : null;
}

/** A cached row, parsed. `undefined` for "no usable row" — a missing row and unreadable JSON are
 *  the same thing to every caller, and neither may throw. */
function readRow<T>(key: string): { value: T; writtenAt: number } | undefined {
  let row;
  try {
    row = getFetchCache(key);
  } catch {
    // A cache read failing degrades to a miss, the same as a cache write failing degrades to a
    // no-op. Neither is worth failing a traveler's request over.
    return undefined;
  }
  if (!row) return undefined;

  const writtenAt = new Date(row.created_at).getTime();
  if (Number.isNaN(writtenAt)) return undefined;

  try {
    return { value: JSON.parse(row.payload_json) as T, writtenAt };
  } catch {
    // Corrupt JSON is a miss, never a throw. The next successful fetch overwrites it.
    return undefined;
  }
}

/**
 * TTLs, gathered here so the whole freshness policy is readable in one place rather than spread
 * across a dozen call sites.
 *
 * The axis is how fast the underlying fact changes in the real world, not how much we would like
 * to avoid the call:
 *
 * - `STATIC` — road geometry, administrative boundaries, a landmark's Wikipedia title, where a
 *   city is. These change on a scale of years. 90 days is short only because it makes the cache
 *   self-healing: a partial answer captured during an Overpass wobble eventually re-asks on its
 *   own, without anyone knowing to clear a row.
 * - `SLOW` — a Wikipedia summary's text and lead image, OpenTripMap's POI corpus. Edited
 *   occasionally; a month still removes essentially all repeat traffic, which is per *reload*.
 * - `CHURNING` — OSM `opening_hours`. The one Overpass payload that genuinely moves.
 * - `VOLATILE` — a weather forecast, revised through the day. Note the *key* for a forecast
 *   includes its date range, so the hit rate is near zero and this exists mostly to collapse the
 *   two duplicate calls a single generation makes. The real win in weather is the historical
 *   archive branch, whose data is immutable and which uses `STATIC`.
 */
export const TTL = {
  STATIC: 90 * 24 * 60 * 60 * 1000,
  SLOW: 30 * 24 * 60 * 60 * 1000,
  CHURNING: 14 * 24 * 60 * 60 * 1000,
  VOLATILE: 60 * 60 * 1000,
} as const;
