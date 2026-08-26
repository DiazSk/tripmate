import { geocodeDestination } from "./weather";
import { buildArrivalPointsQuery, parseArrivalPoints } from "./arrivalPoints";
import type { OverpassArrivalElement } from "./arrivalPoints";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT_MS = 45_000;

export interface OriginAirport {
  name: string;
  iata: string | null;
  distanceKm: number;
}

/** A geocode + an Overpass query, chained. Measured in this session: several seconds on its own,
 *  and it used to re-run on EVERY flight-estimate request for the same city — including when a
 *  traveler had only changed dates or budget after already typing their origin once. Airports
 *  don't move; caching this step is most of the "make it snappy" fix, and a process-lifetime
 *  cache is enough since the server restarts on every deploy anyway. `null` is cached too — a
 *  genuine "nothing airport-like nearby" (or a geocode miss) shouldn't re-run Overpass every
 *  keystroke either. */
const RESOLVE_CACHE_TTL_MS = 15 * 60 * 1000;
const resolveCache = new Map<string, { value: OriginAirport | null; expires: number }>();

function cacheKey(originCity: string): string {
  return originCity.trim().toLowerCase();
}

/**
 * Resolve free text ("Boston") to the nearest real airport, so a real flight search has a
 * `departure_id` to search against. Nothing else in this app collects where the traveler is
 * flying from — `arrivalPoint`/`departurePoint` are the traveler's points AT the destination.
 *
 * Server-side, deliberately not a call to `/api/arrival-points`: that route exists for the
 * browser, and calling it from server code would be an unnecessary HTTP round trip to itself.
 * This fetches Overpass directly instead, mirroring that route's own request shape exactly —
 * `buildArrivalPointsQuery`/`parseArrivalPoints` stay the single source of the query and the
 * ranking logic either way.
 *
 * Fail-soft throughout: a geocoding miss, an Overpass outage, or a city with nothing airport-like
 * nearby (per `arrivalPoints.ts`'s own 100km range) all resolve `null`. What a caller does with
 * `null` is a product decision this function doesn't make — C2 hasn't been designed yet.
 */
export async function resolveOriginAirport(originCity: string): Promise<OriginAirport | null> {
  const key = cacheKey(originCity);
  const cached = resolveCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const result = await resolveOriginAirportUncached(originCity);
  resolveCache.set(key, { value: result, expires: Date.now() + RESOLVE_CACHE_TTL_MS });
  return result;
}

async function resolveOriginAirportUncached(originCity: string): Promise<OriginAirport | null> {
  const geo = await geocodeDestination(originCity);
  if (!geo) return null;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Accept: "*/*", "User-Agent": "TripMate/1.0" },
      body: buildArrivalPointsQuery(geo.lat, geo.lon),
      signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (typeof data?.remark === "string") return null; // Overpass server-side timeout, 200 anyway

    const elements: OverpassArrivalElement[] = Array.isArray(data?.elements) ? data.elements : [];
    const points = parseArrivalPoints(elements, { lat: geo.lat, lon: geo.lon });
    const airport = points.find((p) => p.kind === "airport");
    return airport ? { name: airport.name, iata: airport.iata, distanceKm: airport.distanceKm } : null;
  } catch {
    return null;
  }
}
