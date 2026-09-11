import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SEARCH_RADIUS_M,
  PLACE_CATEGORIES,
  searchPlaces,
  type PlaceCategory,
} from "@/lib/placeSearch";
import { decodePolygon } from "@/lib/searchArea";

/**
 * `GET ?lat=&lng=&q=&category=&radius=&area=` → named places in an area, for the map's search
 * control. `category` takes a comma-separated list and is a **union**: `cafe,bar` is both, not the
 * intersection of the two (nothing is both).
 *
 * `area` is the shape to search — `lat,lng;lat,lng;…`, the buffered hull of what the traveler can
 * see. When it is present `lat`/`lng`/`radius` are only a fallback the providers no longer reach;
 * they stay required because every other caller of this endpoint passes them and nothing else.
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

  // `category=cafe,bar,museum`. Comma-separated rather than a repeated key: it reads in a URL bar,
  // and the panel builds it from a set where order carries no meaning. Unknown names are dropped
  // silently rather than 400-ing the whole request — one stale name in a bookmarked URL should
  // narrow the search, not break it.
  const categories = (params.get("category") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is PlaceCategory => (PLACE_CATEGORIES as readonly string[]).includes(c));

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

  // Rejected whole rather than repaired. This is a public query string feeding a `poly:` filter on
  // a shared community Overpass instance — a half-parsed ring is a query nobody asked for, and the
  // circle fallback below is a perfectly good answer to give instead.
  const area = decodePolygon(params.get("area")) ?? undefined;
  // A shape with more vertices than this is not a hull of a day's stops, it is someone hand-rolling
  // a request. The panel's own polygons top out well under this — a convex hull drops collinear
  // points, so even a fifteen-stop day rarely exceeds eight vertices.
  const MAX_AREA_VERTICES = 32;
  const boundedArea = area && area.length <= MAX_AREA_VERTICES ? area : undefined;

  const result = await searchPlaces({
    lat,
    lng,
    query: params.get("q") ?? undefined,
    categories: categories.length ? categories : undefined,
    radiusM,
    area: boundedArea,
  });
  return NextResponse.json(result);
}
