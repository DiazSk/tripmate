import { runComposioTool } from "./composio";
import type { DietaryNeeds } from "./travelerProfile";

const TOOL_SLUG = "YELP_SEARCH_BUSINESSES";

/** How far from a food stop still counts as "in that area". §3b's area-level stops name a
 *  neighbourhood, so the radius has to cover a walkable district, not a street corner. */
const AREA_RADIUS_M = 1500;
const MAX_EXAMPLES = 2;

/**
 * Yelp's category slugs for the dietary tags the traveler can actually state. Only tags with a
 * real category get looked up: a free-text note like "no raw onion" has no category to search, and
 * guessing one would return confidently irrelevant venues.
 */
const CATEGORY_BY_TAG: Record<string, string> = {
  vegan: "vegan",
  vegetarian: "vegetarian",
  "gluten-free": "gluten_free",
  glutenfree: "gluten_free",
  halal: "halal",
  kosher: "kosher",
};

export interface DietaryVenue {
  name: string;
  rating: number | null;
  price: string | null;
}

/** Maps stated needs onto the searchable categories, deduped. Empty means nothing here is
 *  searchable — which is different from "the traveler has no needs". */
export function searchableCategories(dietary: DietaryNeeds | null): string[] {
  const tags = Array.isArray(dietary?.tags) ? dietary.tags : [];
  const found = new Set<string>();
  for (const tag of tags) {
    const key = String(tag).toLowerCase().replace(/\s+/g, "-");
    const category = CATEGORY_BY_TAG[key] ?? CATEGORY_BY_TAG[key.replace(/-/g, "")];
    if (category) found.add(category);
  }
  return [...found];
}

/** Pure. Reads the venue list, keeping only entries with a usable name. */
export function distilVenues(raw: unknown, limit = MAX_EXAMPLES): DietaryVenue[] {
  const businesses = (raw as { businesses?: unknown } | null)?.businesses;
  if (!Array.isArray(businesses)) return [];

  const out: DietaryVenue[] = [];
  for (const entry of businesses) {
    const b = entry as Record<string, unknown> | null;
    const name = typeof b?.name === "string" ? b.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      rating: typeof b?.rating === "number" ? b.rating : null,
      price: typeof b?.price === "string" ? b.price : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Real venues near a food stop that match the traveler's stated dietary needs.
 *
 * Deliberately does NOT rename the stop. §3b prefers an area over a named restaurant for a routing
 * reason — a committed venue pins the day's route to one address — and that reasoning survives
 * having real data. What it fixes is §3d: the model currently asserts what an area contains, and
 * "several vegan places along the arcade" is a claim nobody checked. This checks it, and supplies
 * the one or two concrete examples §3b already asks for.
 *
 * Returns `null` on a failed lookup and `[]` when the area genuinely has nothing matching — the
 * caller needs to tell those apart, because `[]` is itself a finding worth telling the traveler.
 */
export async function fetchDietaryVenues(
  point: { lat: number; lon: number },
  dietary: DietaryNeeds | null
): Promise<DietaryVenue[] | null> {
  const categories = searchableCategories(dietary);
  if (categories.length === 0) return null;

  const data = await runComposioTool(TOOL_SLUG, {
    latitude: point.lat,
    longitude: point.lon,
    categories: categories.join(","),
    radius: AREA_RADIUS_M,
    limit: 10,
  });
  if (data === null) return null;
  return distilVenues(data);
}

/**
 * The one-line note fragment §3b already asks for — "what to look for there plus one or two
 * example spots" — except the examples are now real rather than recalled.
 *
 * Returns "" for a failed lookup (`null`), because saying nothing is honest; an area that was
 * genuinely searched and came back empty is handled by the caller as a finding, not a note.
 */
export function dietaryNote(venues: DietaryVenue[] | null): string {
  if (!venues || venues.length === 0) return "";
  const named = venues.map((v) => (v.price ? `${v.name} (${v.price})` : v.name));
  return `Verified matching options nearby: ${named.join(", ")}.`;
}

/** Phrased for the critique prompt. An area with nothing the traveler can eat is a §3d defect —
 *  "a beautiful day with one impossible meal in it is a failed day". */
export function noOptionsFinding(stopName: string, date: string): string {
  return `${stopName} on ${date}: a search of this area found no places matching the traveler's stated dietary needs — move the meal to an area that has some.`;
}
