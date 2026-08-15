export interface HighwaySegment {
  points: { lat: number; lng: number }[];
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Roughly matches the framing of a destination-level camera flight (DESTINATION_HEIGHT_M in
 *  mapCamera.tsx) — wide enough to cover the city and its immediate surroundings. */
const SEARCH_RADIUS_M = 30_000;

interface OverpassElement {
  geometry?: { lat: number; lon: number }[];
}

/** Motorways and trunk roads (the "important" highway grades) within SEARCH_RADIUS_M of a
 *  destination, via OSM's free Overpass API — same no-API-key pattern as weather.ts's Open-Meteo
 *  calls. `out geom` returns each way's node coordinates inline, so no separate node lookup. */
export async function fetchMajorHighways(lat: number, lng: number): Promise<HighwaySegment[]> {
  const query = `[out:json][timeout:25];way["highway"~"^(motorway|trunk)$"](around:${SEARCH_RADIUS_M},${lat},${lng});out geom;`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    // Overpass's Apache front-end 406s a bare fetch() — undici sends no `Accept` header by
    // default, and the server treats that as "no acceptable representation" rather than "any".
    headers: { "Content-Type": "text/plain", Accept: "*/*", "User-Agent": "TripMate/1.0" },
    body: query,
  });
  if (!res.ok) throw new Error(`Overpass API returned ${res.status}`);
  const data = await res.json();
  const elements: OverpassElement[] = Array.isArray(data?.elements) ? data.elements : [];

  return elements
    .filter((el) => Array.isArray(el.geometry) && el.geometry.length > 1)
    .map((el) => ({
      points: el.geometry!.map((p) => ({ lat: p.lat, lng: p.lon })),
    }));
}
