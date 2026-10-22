import { TTL, cached } from "./fetchCache";

/**
 * Nominatim (https://nominatim.openstreetmap.org) — free, keyless OpenStreetMap search, as the
 * destination geocoder's second try.
 *
 * Open-Meteo's geocoder knows towns and cities, not regions or parks: "Wadi Rum, Jordan",
 * "Val d'Orcia, Italy", "Cinque Terre, Italy", "Engadin, Switzerland" and "Douro Valley, Portugal"
 * all come back empty, and seven of the ready-made trips are named that way. With no point for the
 * destination the import route could place none of their stops and refused the whole trip.
 * Nominatim finds all seven. Server-only: it imports the cache, so `db.ts` (see `serverFetchCached.ts`).
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
/** Nominatim's usage policy requires an identifying User-Agent; the shape matches `photon.ts`. */
const HEADERS = { "User-Agent": "TripMate/1.0 (+https://github.com/DiazSk/tripmate; destination lookup)" };
const FETCH_TIMEOUT_MS = 8_000;
/** Bump when the cached shape changes, as `GEO_KEY` in `serverFetchCached.ts` explains. */
const KEY = "nominatim1";

/** The first result's point, or null. Nominatim sends `lat`/`lon` as strings. Pure, for the tests. */
export function parseNominatim(body: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first = body[0] as { lat?: unknown; lon?: unknown } | null;
  const read = (v: unknown) => (typeof v === "string" && v.trim() !== "") || typeof v === "number" ? Number(v) : NaN;
  const lat = read(first?.lat);
  const lon = read(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Where a named place is, or null for "not found" and "Nominatim failed" alike (nothing is cached for either). */
export function nominatimPlace(name: string, fetcher: typeof fetch = fetch): Promise<{ lat: number; lon: number } | null> {
  const query = name.trim();
  if (!query) return Promise.resolve(null);
  return cached(`${KEY}:${query.toLowerCase()}`, TTL.STATIC, async () => {
    try {
      const res = await fetcher(`${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return parseNominatim(await res.json());
    } catch {
      return null;
    }
  });
}
