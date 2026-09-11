import { TTL, cached } from "./fetchCache";
import { askOverpass } from "./overpass";

export interface HighwaySegment {
  points: { lat: number; lng: number }[];
}

/** Roughly matches the framing of a destination-level camera flight (DESTINATION_HEIGHT_M in
 *  mapCamera.tsx) — wide enough to cover the city and its immediate surroundings. */
const SEARCH_RADIUS_M = 30_000;

/**
 * Motorways and trunk roads (the "important" highway grades) within SEARCH_RADIUS_M of a
 * destination, via OSM's free Overpass API — same no-API-key pattern as weather.ts's Open-Meteo
 * calls. `out geom` returns each way's node coordinates inline, so no separate node lookup.
 *
 * Goes through `askOverpass`, which falls across the mirrors. This used to hold its own `fetch`
 * against `overpass-api.de` alone and `throw` on a bad status, which is how a 30km motorway query
 * for Kyoto returned a 502 to the client while two other instances answered the identical query
 * in under two seconds. See `overpass.ts` for the measurement.
 */
export async function fetchMajorHighways(lat: number, lng: number): Promise<HighwaySegment[]> {
  // 2dp ≈ 1.1km against a 30km query radius — 3% of it, invisible in the answer, and it collapses
  // the slightly-different geocodes of one city onto a single row. Deliberately coarser than
  // `mapCamera`'s 4dp client dedupe and `boxKey`'s 3dp: the right precision is the one at which
  // *this* query's answer stops changing, not a house constant.
  const key = `roads:${lat.toFixed(2)}:${lng.toFixed(2)}`;

  const segments = await cached(key, TTL.STATIC, async () => {
    const query = `[out:json][timeout:25];way["highway"~"^(motorway|trunk)$"](around:${SEARCH_RADIUS_M},${lat},${lng});out geom;`;
    const elements = await askOverpass(query);
    if (elements === null) return null;

    const parsed = elements
      .filter((el) => Array.isArray(el.geometry) && el.geometry.length > 1)
      .map((el) => ({ points: el.geometry!.map((p) => ({ lat: p.lat, lng: p.lon })) }));

    // `null`, not `[]`, when nothing came back. A 30km radius around any real destination has
    // motorways in it, so an empty answer here is a refusal wearing a 200 — and caching it would
    // freeze this city as roadless for the whole TTL. Same rule `exportMapData.ts` already
    // applies to its own geometry.
    return parsed.length ? parsed : null;
  });

  // Still throws when there is neither an answer nor a cached one, because that is this function's
  // existing contract — `/api/roads` catches it and the map draws no highways.
  if (segments === null) throw new Error("Overpass unavailable on every mirror, and nothing cached");
  return segments;
}
