import { askOverpass, type OverpassElement } from "./overpass";
import { cached } from "./fetchCache";
import type { EvidencePlace } from "./meriAnswer";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PLACES = 8;

/** "Gluten-free" and "gluten free" are both OSM's `diet:gluten_free`. */
function dietKey(diet: string): string {
  return diet.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Eating places near a point that say they serve the diet. OSM's `diet:*` tags are sparse, so a
 * traveller with no stated diet gets any place with a cuisine rather than a search that finds
 * nothing; the diet is the filter only when there is one.
 */
export function dietPlacesQuery(point: { lat: number; lng: number }, diet: string | null, radiusM: number): string {
  const filter = diet ? `["diet:${dietKey(diet)}"~"yes|only"]` : `["cuisine"]`;
  return `[out:json][timeout:15];nwr["amenity"~"restaurant|cafe|fast_food"]${filter}(around:${radiusM},${point.lat},${point.lng});out center 40;`;
}

/** The evidence ids are reassigned by the gatherer; the OSM id here only keeps them unique until then. */
export function distilDietPlaces(elements: OverpassElement[], diet: string | null, limit = MAX_PLACES): EvidencePlace[] {
  void diet; // the query already filtered on it; kept so the two functions read as a pair
  const out: EvidencePlace[] = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || lat === undefined || lng === undefined) continue;
    const cuisine = el.tags?.cuisine?.split(";").map((c) => c.trim().replace(/_/g, " ")).filter(Boolean).join(", ");
    out.push({ id: `osm-${el.type ?? "n"}${el.id ?? out.length}`, name, lat, lng, ...(cuisine ? { detail: cuisine } : {}), sourceId: "osm" });
    if (out.length === limit) break;
  }
  return out;
}

/** `null` is "Overpass could not answer", `[]` is "nothing there says it serves that diet". */
export async function fetchDietPlaces(point: { lat: number; lng: number }, diet: string | null): Promise<EvidencePlace[] | null> {
  const key = `dietplaces:${point.lat.toFixed(3)},${point.lng.toFixed(3)}:${diet ? dietKey(diet) : ""}`;
  const elements = await cached(key, 7 * DAY_MS, () => askOverpass(dietPlacesQuery(point, diet, 2000), { deadline: Date.now() + 8000 }));
  return elements === null ? null : distilDietPlaces(elements, diet);
}
