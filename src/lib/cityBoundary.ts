/**
 * A city's administrative outline and the towns around it, from OSM Overpass.
 *
 * Same no-API-key, fail-soft pattern as `roads.ts` — which is also why Overpass rather than
 * Nominatim: the boundary data is the same OSM relation either way, and Overpass is already a
 * dependency here with its headers, its timeout behaviour and its 406 quirk documented.
 *
 * The point of drawing the outline is orientation. A destination pin says where a city is; it
 * says nothing about how far it extends, so a traveler cannot tell whether a stop 12km out is
 * "in Lisbon" or an hour's trip to somewhere else. The neighbour labels answer the other half of
 * the same question — what the places just outside the line are called.
 */

import { askOverpass } from "./overpass";

export interface CityBoundary {
  /**
   * The boundary as OSM stores it: a list of *way fragments*, not closed rings.
   *
   * An administrative relation is assembled from dozens of separate ways (Lisboa's is 44 of
   * them), and Overpass returns each one's geometry independently. Drawn as polylines they
   * reconstruct the outline exactly; stitching them into closed rings would only be needed to
   * *fill* the shape, which this deliberately does not do — a filled polygon over photorealistic
   * terrain hides the city it is describing.
   */
  segments: { lat: number; lng: number }[][];
  /** The name OSM has for the boundary that matched, which is not always what was searched
   *  ("Lisbon" is `name:en` on a relation whose `name` is "Lisboa"). Shown so a wrong match is
   *  visible rather than silent. */
  name: string;
}

export interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
  /** OSM's own `place` value — city, town, suburb, village. Used to rank and to size the label. */
  kind: string;
}

/** How far out to look for neighbours. Wide enough to catch the ring of towns a city commutes
 *  with, tight enough that the answer is still "around here" rather than a region. */
const NEIGHBOUR_RADIUS_M = 45_000;

/** Way fragments shorter than this are dropped. An administrative relation carries strays — a
 *  pier, a single boundary stone's way — and a two-point stub drawn on the globe reads as a
 *  glitch rather than a border. */
const MIN_SEGMENT_POINTS = 4;

/** Bounding-box diagonal, in degrees, past which a boundary is a region rather than a city.
 *  ~1.5° is roughly 165km — comfortably larger than any real metropolitan area and far smaller
 *  than a province. */
const MAX_CITY_SPAN_DEG = 1.5;

/** `place` values that mean "an administrative tier", not "a settlement". */
const REGIONAL_PLACES = new Set(["country", "state", "province", "region", "county", "district"]);
/** …and the ones that do mean a settlement. */
const CITY_PLACES = new Set(["city", "town", "municipality", "borough"]);

interface OverpassGeomElement {
  id?: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  geometry?: { lat: number; lon: number }[];
  lat?: number;
  lon?: number;
}

/** Falls across the Overpass mirrors via `askOverpass`, then keeps this module's existing
 *  throw-on-unreachable contract — every caller below already treats a throw as "no outline",
 *  and returning `[]` instead would render "this city has no boundary" for "we could not ask". */
async function overpass(query: string): Promise<OverpassGeomElement[]> {
  const elements = await askOverpass(query);
  if (elements === null) throw new Error("Overpass unavailable on every mirror");
  return elements as OverpassGeomElement[];
}

/**
 * The administrative outline containing a point.
 *
 * `is_in` rather than a name match, deliberately: a name search returns every "Springfield" on
 * earth and no way to tell which one the traveler geocoded, while the coordinates are already
 * unambiguous. Admin levels 6-8 are the city/municipality band in most countries — 4 is a
 * state, 10 a neighbourhood — and the smallest match wins, since a point in Lisbon is inside
 * both Lisboa and the Área Metropolitana.
 *
 * Returns null for "no boundary found or the lookup failed" and never throws: an outline is
 * ambient orientation, and a city with no mapped relation should cost the map a polygon, not
 * the destination.
 */
export async function fetchCityBoundary(
  lat: number,
  lng: number,
  searchedName?: string
): Promise<CityBoundary | null> {
  try {
    // Two queries, and the split is what makes this usable rather than tidy.
    //
    // A point sits inside every boundary above it, and asking for all their geometry at once
    // means downloading the country. At Tokyo that is the metropolis *including the Ogasawara
    // islands* — `out geom` on it ran past a 30s abort and the whole lookup failed, while the
    // same query asking only for tags answered in about a second. So: choose from cheap
    // metadata, then fetch geometry for the one relation that won.
    //
    // `out tags bb` adds each candidate's bounding box, which is the size signal the choice
    // needs and costs nothing.
    const candidates = (
      await overpass(
        `[out:json][timeout:25];` +
          `is_in(${lat},${lng})->.a;` +
          `relation(pivot.a)["boundary"="administrative"]["name"];` +
          `out tags bb;`
      )
    )
      .map((el) => {
        const tags = el.tags ?? {};
        const names = [tags["name:en"], tags.name].filter(Boolean) as string[];
        const bounds = el.bounds;
        const span = bounds
          ? Math.hypot(bounds.maxlat - bounds.minlat, bounds.maxlon - bounds.minlon)
          : Infinity;
        return {
          id: el.id,
          name: names[0] ?? "",
          level: Number(tags.admin_level ?? 0),
          place: tags.place ?? "",
          span,
          matchesSearch:
            !!searchedName && names.some((n) => normalise(n) === normalise(searchedName)),
        };
      })
      .filter(
        (c) =>
          c.id !== undefined &&
          c.name &&
          // Anything bigger than a large metropolitan area is not what "show me this city"
          // meant, whatever it is called. This is what rejects Tokyo Metropolis — which does
          // match the search term exactly, and whose outline runs a thousand kilometres into
          // the Pacific.
          c.span <= MAX_CITY_SPAN_DEG &&
          // Nor is an administrative tier that is explicitly not a settlement.
          !REGIONAL_PLACES.has(c.place)
      );
    if (candidates.length === 0) return null;

    // The searched name first, then OSM's own `place` marker, then the most local level.
    //
    // Name outranks `place` because at Lisbon's coordinates the district and the city are both
    // called Lisbon; `place` then settles which. Level is only a last tiebreak — on its own it
    // picks a parish over the city, since the level that *means* city is 8 in Germany, 7 in
    // Portugal and 6 elsewhere.
    candidates.sort(
      (a, b) =>
        Number(b.matchesSearch) - Number(a.matchesSearch) ||
        Number(CITY_PLACES.has(b.place)) - Number(CITY_PLACES.has(a.place)) ||
        b.level - a.level
    );
    const best = candidates[0];

    const segments = (await overpass(`[out:json][timeout:25];relation(${best.id});out geom;`))
      .flatMap((el) => el.members ?? [])
      .filter((m) => m.role === "outer" && Array.isArray(m.geometry))
      .map((m) => m.geometry!.map((p) => ({ lat: p.lat, lng: p.lon })))
      .filter((seg) => seg.length >= MIN_SEGMENT_POINTS);
    if (segments.length === 0) return null;

    return { segments, name: best.name };
  } catch {
    return null;
  }
}

/** Lowercased, unaccented, punctuation-free — so "Lisbon" matches "Lisbon" and "São Paulo"
 *  matches "Sao Paulo". Not a general transliteration: it only has to make two spellings of the
 *  same place agree. */
function normalise(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Named places around a point, nearest first.
 *
 * Cities and towns only — `suburb` and `village` would bury a capital's ring of real neighbours
 * under a hundred of its own districts, which is the opposite of the orientation this is for.
 * The origin city itself is filtered by distance rather than by name, since OSM's name for it is
 * often not the one that was searched.
 */
export async function fetchNearbyPlaces(
  lat: number,
  lng: number,
  limit = 12,
  excludeName?: string
): Promise<NearbyPlace[]> {
  try {
    const elements = await overpass(
      `[out:json][timeout:25];` +
        `node["place"~"^(city|town)$"]["name"](around:${NEIGHBOUR_RADIUS_M},${lat},${lng});` +
        // `out;` and NOT `out tags;` — `tags` is a body modifier meaning "ids and tags only",
        // so it drops the coordinates, and every result then failed the lat/lon guard below and
        // the list came back empty with no error anywhere.
        `out;`
    );
    return elements
      .filter((el) => typeof el.lat === "number" && typeof el.lon === "number" && el.tags?.name)
      .map((el) => ({
        name: el.tags!["name:en"] ?? el.tags!.name,
        lat: el.lat!,
        lng: el.lon!,
        kind: el.tags!.place,
      }))
      // Ordering only, so the cheap planar approximation is right: no distance is ever shown.
      .sort(
        (a, b) =>
          (a.lat - lat) ** 2 + (a.lng - lng) ** 2 - ((b.lat - lat) ** 2 + (b.lng - lng) ** 2)
      )
      // Drop the origin itself, by distance *and* by name. Distance alone misses it whenever
      // OSM's place node sits well off the geocoded centre (Delhi's is ~10km away), and the city
      // listing itself as its own neighbour is the one entry guaranteed to be useless.
      .filter((p) => Math.hypot(p.lat - lat, p.lng - lng) > 0.02)
      .filter((p) => !excludeName || normalise(p.name) !== normalise(excludeName))
      .slice(0, limit);
  } catch {
    return [];
  }
}
