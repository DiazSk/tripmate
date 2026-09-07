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
  const query = `[out:json][timeout:25];way["highway"~"^(motorway|trunk)$"](around:${SEARCH_RADIUS_M},${lat},${lng});out geom;`;

  const elements = await askOverpass(query);
  // Still throws when no mirror could answer, because that is this function's existing contract —
  // `/api/roads` catches it and the map simply draws no highways. Changing it to return `[]` would
  // turn "we could not ask" into "this city has no motorways", which is the exact conflation
  // `overpass.ts` warns about.
  if (elements === null) throw new Error("Overpass unavailable on every mirror");

  return elements
    .filter((el) => Array.isArray(el.geometry) && el.geometry.length > 1)
    .map((el) => ({
      points: el.geometry!.map((p) => ({ lat: p.lat, lng: p.lon })),
    }));
}
