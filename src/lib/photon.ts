import { haversineKm } from "./travelTime";

/**
 * Photon (https://photon.komoot.io) — free, keyless, fuzzy search over OpenStreetMap.
 *
 * The saved-places geocoder's middle step (`anchorGeocode.ts`). Overpass matches names exactly, so
 * "Leopold Cafe" misses an OSM node tagged "Cafe Leopold", and its fuzzy search shares mirrors that
 * turn a burst of lookups away. Photon is built for exactly this: typed names, ranked by distance
 * from a bias point. Measured on Mumbai: all three of a traveller's pasted names in under a second,
 * where the Overpass path returned nothing after its full budget.
 */

const PHOTON_URL = "https://photon.komoot.io/api/";
/** Photon's fair-use policy asks for an identifying client; the shape matches `wikiTitle.ts`. */
const HEADERS = { "User-Agent": "TripMate/1.0 (+https://github.com/DiazSk/tripmate; saved-places lookup)" };
/** Per request. Photon answers in well under a second; a hung one must not eat the caller's budget. */
const FETCH_TIMEOUT_MS = 5_000;
/** A few candidates, not one: the nearest-ranked hit can still be another city's ("Leopold Cafe"
 *  also exists in Brussels), and the radius below picks the first one that is actually here. */
const LIMIT = 5;
/**
 * How far from the destination's point a hit may be. The point is a city centroid, and a metro
 * reaches 30-40km from its centre (Colaba to Borivali in Mumbai, central Tokyo to Hachioji), plus
 * the day trip a saved place is often for. 50km keeps all of that and still rejects the same name
 * in the next city over, which is the whole risk: "Marine Drive" is a street in Kochi too.
 */
export const MAX_DISTANCE_KM = 50;
/** Photon's area-level results. A vague query ("Mumbai food") can match the city itself, and its
 *  centroid would read as the place being found; only a street, a building or a point counts. */
const AREA_TYPES = new Set(["city", "county", "state", "country"]);

export interface PhotonHit {
  lat: number;
  lng: number;
  /** Where it was found, for display: the matched name when it differs from what was typed, then
   *  the neighbourhood. Never sent to the model. */
  area?: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; street?: string; locality?: string; district?: string; city?: string; type?: string };
}

/** Display label for a hit. OSM's `district` is often an administrative ward ("A Ward"), so the
 *  locality comes first and the district only stands in when there is nothing better. */
export function photonArea(typed: string, p: NonNullable<PhotonFeature["properties"]>): string | undefined {
  const same = (a?: string) => !!a && a.trim().toLowerCase() === typed.trim().toLowerCase();
  const matched = p.name && !same(p.name) ? p.name : undefined;
  const where = p.locality ?? p.street ?? p.district ?? p.city;
  const parts = [matched, where && where !== matched ? where : undefined].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** The first feature within `MAX_DISTANCE_KM` of `near` that is not a whole area, or undefined.
 *  Pure, for the tests. */
export function pickHit(typed: string, features: PhotonFeature[], near: { lat: number; lon: number }): PhotonHit | undefined {
  for (const f of features) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (AREA_TYPES.has(f.properties?.type ?? "")) continue;
    if (haversineKm(near, { lat, lon: lng }) > MAX_DISTANCE_KM) continue;
    return { lat, lng, area: photonArea(typed, f.properties ?? {}) };
  }
  return undefined;
}

/** Fails soft: `null` when the request failed, `undefined` when Photon answered and nothing near
 *  the destination matched — the caller falls through either way, but they are different facts. */
export async function photonLookup(name: string, near: { lat: number; lon: number }): Promise<PhotonHit | null | undefined> {
  const url = `${PHOTON_URL}?${new URLSearchParams({ q: name, lat: String(near.lat), lon: String(near.lon), limit: String(LIMIT), lang: "en" })}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`[photon] lookup failed: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { features?: PhotonFeature[] };
    return pickHit(name, json.features ?? [], near);
  } catch (err) {
    console.warn("[photon] lookup failed", err instanceof Error ? err.message : err);
    return null;
  }
}
