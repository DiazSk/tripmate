import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SEARCH_RADIUS_M,
  PLACE_CATEGORIES,
  searchPlaces,
  type PlaceCategory,
} from "@/lib/placeSearch";

/**
 * `GET ?lat=&lng=&q=&category=&radius=` → named places around a point, for the map's search
 * control.
 *
 * Distinct from `/api/nearby-pois`, which answers "what is standing at this exact coordinate" for
 * a click and searches 250m of top-rated attractions. This one is a browse: a neighbourhood's
 * worth of cafés, restaurants, bars, museums, parks or shops, optionally filtered by name.
 *
 * Always 200 with a list, possibly empty — a neighbourhood with no cafés and an Overpass rate
 * limit look the same to the traveler, and both are answered with "nothing found here" rather than
 * an error they cannot act on. The provider that answered comes back with the results so the UI
 * can attribute it honestly; see `placeSearch.ts` for why there are two.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const rawCategory = params.get("category");
  const category = (PLACE_CATEGORIES as readonly string[]).includes(rawCategory ?? "")
    ? (rawCategory as PlaceCategory)
    : undefined;

  // `params.get` before `Number`, and that ordering is the whole point: `Number(null)` is **0**,
  // which is finite, so reading it the other way round silently clamped every request with no
  // `radius` to the 200m floor instead of the 1.8km default. Category searches still returned
  // something on a busy street and looked fine; a search by name found nothing, anywhere, and the
  // endpoint reported an honest empty list for it.
  const rawRadius = params.get("radius");
  const parsedRadius = rawRadius === null ? Number.NaN : Number(rawRadius);
  // Clamped rather than trusted: this is a public endpoint and the radius goes straight into an
  // Overpass `around:`, where a large enough number is a request nobody should be able to make of
  // a shared community server from a query string.
  const radiusM = Number.isFinite(parsedRadius)
    ? Math.min(Math.max(parsedRadius, 200), 8000)
    : DEFAULT_SEARCH_RADIUS_M;

  const result = await searchPlaces({
    lat,
    lng,
    query: params.get("q") ?? undefined,
    category,
    radiusM,
  });
  return NextResponse.json(result);
}
