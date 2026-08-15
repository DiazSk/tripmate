export interface CandidatePoi {
  name: string;
  lat: number;
  lon: number;
  category: string | null;
}

const OPENTRIPMAP_BASE = "https://api.opentripmap.com/0.1/en/places/radius";
const DEFAULT_RADIUS_M = 15000;

/** Top-attractions candidate list for the Step 2b POI picker. Requires
 *  OPENTRIPMAP_API_KEY (free tier at https://opentripmap.io) — fails soft:
 *  missing key, network error, or a non-ok response all return []. */
export async function getCandidatePois(lat: number, lon: number, limit = 12): Promise<CandidatePoi[]> {
  const apiKey = process.env.OPENTRIPMAP_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL(OPENTRIPMAP_BASE);
    url.searchParams.set("radius", String(DEFAULT_RADIUS_M));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("rate", "2");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url);
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
      }));
  } catch {
    return [];
  }
}
