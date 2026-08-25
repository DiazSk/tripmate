export interface CandidatePoi {
  name: string;
  lat: number;
  lon: number;
  category: string | null;
}

const OPENTRIPMAP_BASE = "https://api.opentripmap.com/0.1/en/places/radius";
/** Wall-clock cap on each outbound call. Without a signal, undici lets a hung upstream sit for
 *  ~5 minutes and the request that triggered it hangs with it — the literal "the page is stuck"
 *  failure. An abort throws, which is the same shape as any other network failure here, so it
 *  lands on the fail-soft path that already exists rather than adding a new error surface. */
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_RADIUS_M = 15000;

export interface PoiSearchOptions {
  /** Search radius in metres. The 15km default is a *city* sweep for the Step 2b picker. A map
   *  click wants something far tighter — the traveler is pointing at a building, not a district. */
  radiusM?: number;
  /**
   * OpenTripMap's own significance rating, 1-3, as a floor.
   *
   * `2` for the picker, which is asking "what is this city known for". A map click is asking
   * "what is *here*", where a rating floor is actively wrong: the cafe someone is pointing at is
   * rated 1 or unrated, and filtering it out returns an empty list over a street full of places.
   */
  minRate?: number;
}

/** Top-attractions candidate list for the Step 2b POI picker, and the nearby lookup behind
 *  adding a stop by clicking the map. Requires OPENTRIPMAP_API_KEY (free tier at
 *  https://opentripmap.io) — fails soft: missing key, network error, or a non-ok response all
 *  return []. */
export async function getCandidatePois(
  lat: number,
  lon: number,
  limit = 12,
  { radiusM = DEFAULT_RADIUS_M, minRate = 2 }: PoiSearchOptions = {}
): Promise<CandidatePoi[]> {
  const apiKey = process.env.OPENTRIPMAP_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL(OPENTRIPMAP_BASE);
    url.searchParams.set("radius", String(radiusM));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("rate", String(minRate));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((p) => p.name && p.point)
      .map((p) => ({
        name: p.name as string,
        lat: p.point.lat as number,
        lon: p.point.lon as number,
        category: typeof p.kinds === "string" ? p.kinds.split(",")[0] : null,
      }))
      // Nearest first. The radius query returns them in OpenTripMap's own order, which for a map
      // click is the wrong one — the traveler pointed at a spot, so the thing standing on that
      // spot should be the first option rather than the highest-rated thing within the circle.
      .sort(
        (a, b) =>
          squaredDegreeDistance(a, lat, lon) - squaredDegreeDistance(b, lat, lon)
      );
  } catch {
    return [];
  }
}

/** Ordering only, so the cheap planar approximation is right: over a few hundred metres the
 *  longitude convergence is a constant scale on both sides of the comparison, and no distance is
 *  ever shown to anyone. */
function squaredDegreeDistance(poi: CandidatePoi, lat: number, lon: number): number {
  const dLat = poi.lat - lat;
  const dLon = poi.lon - lon;
  return dLat * dLat + dLon * dLon;
}
