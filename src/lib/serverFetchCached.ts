import { geocodeDestination, getWeatherWithMeta } from "./weather";
import { getCandidatePois, type CandidatePoi } from "./pois";
import { TTL, cached } from "./fetchCache";

/**
 * Cached wrappers for the two upstreams whose own modules **must not** import the cache.
 *
 * ## Why this file exists instead of wrapping in place
 *
 * `weather.ts` and `pois.ts` are both reachable from the client bundle:
 *
 * - `src/components/DestinationSearch.tsx` is `"use client"` and *value*-imports
 *   `suggestDestinations` from `weather.ts`.
 * - `src/lib/useTripCamera.ts` is a client hook and value-imports `geocodeDestination`.
 * - `HomeView.tsx` and `PoiCandidatePicker.tsx` import `CandidatePoi` from `pois.ts` with a plain
 *   `import` rather than `import type`, so it is one refactor away from not being elided.
 *
 * `fetchCache.ts` imports `db.ts`, which opens **native `libsql` at module load**, and
 * `next.config.ts` sets no `serverExternalPackages`. Putting the cache import at the top of either
 * module would therefore pull a native addon into the browser graph. Best case that is a build
 * error; worse, it builds and dies at runtime — and this repo has already shipped a `next build`
 * that succeeded while serving a chunk no browser could parse (see the `@spz-loader/core` note in
 * CLAUDE.md). Keeping the boundary here means the client graph never sees `db.ts` at all.
 *
 * **Anything importing from this file is server-only.** If a client component ever needs one of
 * these, it calls the API route, it does not import this.
 *
 * Note `useTripCamera` geocodes straight from the browser to Open-Meteo. No server cache can help
 * that path, and it is not a bug — it is a client talking to a public API directly.
 */

/**
 * Where a named place is. Cities do not move, so this is as static as anything here.
 *
 * The key is the trimmed, lowercased query, because it *is* a text lookup — two travellers typing
 * "Kyoto, Japan" and "kyoto, japan " are asking the identical question. `geocodeDestination`
 * already returns `null` for both "no such place" and "Open-Meteo failed", so nothing is cached
 * for either; the negative is cheap to re-ask and conflating it with an outage is not worth it.
 */
export function geocodeDestinationCached(name: string) {
  const key = `geo:${name.trim().toLowerCase()}`;
  return cached(key, TTL.STATIC, () => geocodeDestination(name));
}

/**
 * OpenTripMap candidate POIs.
 *
 * **4dp on the coordinates, not the 2dp the Overpass lookups use.** This is called at two very
 * different scales — `tripFetch` sweeps 15km around a destination, while `/api/nearby-pois` runs
 * at a 250m radius on a map click — and at 250m, 2dp of key slop (~1.1km) would serve a different
 * street's cafés. `radiusM`, `minRate` and `limit` are all in the key for the same reason: the two
 * callers pass different values and each combination is a different question.
 */
export function getCandidatePoisCached(
  lat: number,
  lon: number,
  limit?: number,
  opts?: { radiusM?: number; minRate?: number }
): Promise<CandidatePoi[]> {
  // The missing-key case returns before the cache is consulted. `getCandidatePois` answers `[]`
  // both when there is no `OPENTRIPMAP_API_KEY` and when the fetch fails, so caching it blind
  // would write "this city has no points of interest" and — worse — adding the key later would
  // change nothing until the rows expired.
  if (!process.env.OPENTRIPMAP_API_KEY) return Promise.resolve([]);

  const key = [
    "otm",
    lat.toFixed(4),
    lon.toFixed(4),
    opts?.radiusM ?? "",
    opts?.minRate ?? "",
    limit ?? "",
  ].join(":");

  return cached(key, TTL.SLOW, async () => {
    const pois = await getCandidatePois(lat, lon, limit, opts);
    // Still `[]`-on-failure inside `pois.ts`, so an empty answer is ambiguous here. Treated as
    // "could not ask" and left uncached: a real 250m radius with nothing in it costs one cheap
    // re-ask, while a cached outage would blank a neighbourhood for a month.
    return pois.length ? pois : null;
  }).then((pois) => pois ?? []);
}

/**
 * The forecast (or the historical archive) for a date range.
 *
 * **The TTL is chosen from the dates, and that is the only interesting thing here.** A range that
 * has already ended is served by Open-Meteo's *archive* endpoint and is immutable — last week's
 * weather is not going to be revised — so it caches like any other static fact. A range that
 * includes today or the future is a forecast, revised through the day, and gets an hour.
 *
 * Be honest about the hit rate on the forecast branch: the key contains the date range, so it only
 * hits when the identical trip is fetched twice inside the hour. That does happen — walking back
 * and forward through the wizard re-runs `/api/trip-fetch` — but it is a tidiness win, not the
 * thing that saves a demo. One hour is short enough that no plan can be written against a
 * meaningfully stale outlook, which is what would actually matter: the itinerary reasons about
 * rain and daylight.
 *
 * Note this does **not** collapse the two Open-Meteo calls a single bundle makes (the daily
 * forecast and the hourly humidity) — those are inside `fetchWeatherBundle`, below this seam.
 * And `generationRunner` deliberately still calls the uncached `getWeatherForDates`: generation is
 * the one path where the plan is being written against the forecast, so it gets a live one.
 *
 * 2dp on the coordinates: Open-Meteo snaps to its own grid anyway, so a ~1km key difference is
 * below the resolution of the answer.
 */
export function getWeatherWithMetaCached(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
) {
  const alreadyOver = endDate < new Date().toISOString().slice(0, 10);
  const key = `wx:${lat.toFixed(2)}:${lon.toFixed(2)}:${startDate}:${endDate}`;

  return cached(key, alreadyOver ? TTL.STATIC : TTL.VOLATILE, async () => {
    const bundle = await getWeatherWithMeta(lat, lon, startDate, endDate);
    // `fetchWeatherBundle` degrades to an empty `days` array rather than throwing, so an empty
    // one is indistinguishable from an Open-Meteo outage. Not cached: a plan generated against a
    // cached "no weather" would silently lose every rain and daylight rule it has.
    return bundle.days.length ? bundle : null;
  });
}
