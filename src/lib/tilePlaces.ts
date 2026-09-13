// Relative imports, not `@/lib` — same rule `placeSearch.ts` records at its own head: one aliased
// specifier makes this module, and its test, unreachable from `scripts/ts-resolve.mjs`.
import { metresBetween } from "./peekRange";
import { pointInPolygon, type LatLng } from "./searchArea";
import type { FoundPlace, PlaceCategory } from "./placeSearch";

/**
 * The map's own vector tiles, read as a search index.
 *
 * **The tiles are already downloaded.** Every POI the map draws a label for arrived in the same
 * `openmaptiles` tile as the streets under it, so asking them "what cafés are on screen" costs no
 * network call at all and cannot be rate-limited — which is the entire reason this exists. The
 * Overpass index behind `placeSearch.ts` is a shared community server that throttles exactly the
 * traffic a search box generates, and being turned away is its ordinary case rather than its
 * exceptional one.
 *
 * Coverage is not the compromise either. Measured against the tile the app actually loads
 * (`planet/14/8707/6000`, central Siena) plus its eight neighbours: **11,620 POI features, 4,727
 * named**, including 161 cafés and 372 restaurants — against the 60 cafés a comparable Overpass
 * query returns, which is capped at 15 by the time it reaches the panel anyway.
 *
 * Two things the tiles genuinely cannot do, both load-bearing on how this is wired:
 *
 * - **POIs exist only at z14.** The `poi` layer declares minzoom 11 and is empty in practice below
 *   14; the source's maxzoom *is* 14, so every zoom past it reads the same z14 tile overzoomed and
 *   this keeps working all the way in. At a trip-overview framing there is simply nothing to
 *   search, which is why the caller falls back to Overpass on an empty answer rather than treating
 *   it as "no cafés here".
 * - **Four fields, and no id.** `name`, `class`, `subclass`, `rank` — verified against the live
 *   tilejson. No `osm_id`, so a tile hit cannot be used as a key to fetch anything else, and no
 *   website, phone, hours or address. The card fills those in for the one place it is opened on.
 */

/** One named point out of a `poi` source-layer, already converted to lng/lat by the renderer. */
export interface TilePoi {
  name: string;
  /**
   * `name:latin` / `name_en`, when the tile carries one.
   *
   * Free-text search matches both, because the tile's `name` is the *local* name: someone reading
   * a Latin-alphabet map of Kyoto and typing "Kiyomizu" is searching the only spelling they have.
   */
  nameLatin?: string;
  /** OpenMapTiles' normalised class — `cafe`, `fast_food`, `art_gallery`. */
  klass: string;
  /** The raw OSM tag value the class was derived from — `ice_cream`, `guest_house`. */
  subclass: string;
  lat: number;
  lng: number;
}

/**
 * OpenMapTiles classes, grouped into the six chips the panel offers.
 *
 * Built from a dump of every distinct `class`/`subclass` pair across z14 tiles for Siena, Rome,
 * Paris, Tokyo and New York — not from the schema docs, which list classes this planet build does
 * not emit and omit some it does. The groupings mirror `OSM_FILTERS` in `placeSearch.ts` tag for
 * tag, so a chip means the same thing whichever index answers it:
 *
 * - `cafe` ← `amenity~^(cafe|ice_cream)$`
 * - `bar` ← `amenity~^(bar|pub|biergarten)$`, which OpenMapTiles splits across `bar` and `beer`
 * - `sights` ← four different tag keys, which is why `OSM_FILTERS` holds a list per category
 * - `hotel` ← `tourism~^(hotel|hostel|guest_house|motel|…)$`, all one `lodging` class here
 *
 * `shop` is the one that cannot be a single class. Overpass asks for `["shop"]` — *any* shop tag —
 * and OpenMapTiles scatters those across a catch-all `shop` class plus a dozen specific ones. The
 * list below is every one of those seen in the dump; a shop class this misses reads as a generic
 * `place`, which is a thinner answer rather than a wrong one.
 */
const CLASS_TO_CATEGORY: Record<string, PlaceCategory> = {
  cafe: "cafe",
  ice_cream: "cafe",
  restaurant: "restaurant",
  fast_food: "restaurant",
  bar: "bar",
  beer: "bar",
  // Everything a traveler means by "worth looking at". Measured across twelve city z14 tiles:
  // 1,723 named features, 84% of them named.
  museum: "sights",
  art_gallery: "sights",
  place_of_worship: "sights",
  attraction: "sights",
  theatre: "sights",
  castle: "sights",
  monument: "sights",
  cinema: "sights",
  lodging: "hotel",
  park: "park",
  garden: "park",
  shop: "shop",
  alcohol_shop: "shop",
  bakery: "shop",
  bicycle: "shop",
  butcher: "shop",
  car: "shop",
  clothing_store: "shop",
  grocery: "shop",
  hairdresser: "shop",
  laundry: "shop",
  music: "shop",
};

/**
 * **Why there is no Parking chip, which is not the reason it looks like.**
 *
 * Only 330 of 2,245 `parking` features carry a name, and the loop below drops the rest — 15%, and a
 * ten-city US downtown sample lands on the same 15% (7% in Houston and Nashville, 35% in Atlanta),
 * so the ratio is not a European artefact. It is also not, on its own, a reason to refuse the chip.
 *
 * A low named ratio only disqualifies a category if the traveler can *see* what the chip misses,
 * and **Liberty draws no parking POI at all**: its four `poi` layers are `poi_r20`, `poi_r7`,
 * `poi_r1` and `poi_transit`, and not one filters on the parking class. Nothing reads as broken,
 * because nothing is drawn. At viewport scale the named ones would fill a list that caps at
 * `MAX_RESULTS` anyway — measured over ~1.1km, 14 in downtown Houston and 12 in Atlanta against 4
 * and 7 cafés — and they are real garages ("Icon", "SP+", "Centerpark West 58th Street").
 *
 * What actually defers it is the palette. An eighth chip needs an eighth pin colour, and under
 * `MIN_COLOUR_DISTANCE` plus the legibility floors in `searchPalette.ts` the best candidate left is
 * an olive that reads as a darker `shop` yellow. Worth revisiting when the chips are grouped and
 * colour stops carrying the distinction by itself.
 *
 * `bicycle_parking` is a different answer: 23 named of 4,093, and 51 of 3,809 across the US
 * sample. That one is refused on its merits and should stay refused.
 */

/**
 * Classes dropped outright, rather than left to fall through to `place`.
 *
 * `office` is the second-largest named class in the tiles — 3,513 named across twelve city z14
 * tiles, every one of them a lawyer, an accountant, an insurance broker or a letting agent. Falling
 * through to `place` makes them unreachable by chip but still returned by free text, so typing a
 * street name in a business district buries the café somebody was looking for. Nothing here is a
 * thing a traveler goes to, and `OSM_FILTERS` never asked Overpass for them either — so dropping
 * them is the only way the two indexes agree.
 *
 * A deny-list rather than an allow-list, deliberately: the tiles carry 100 classes and the long
 * tail is mostly harmless (a library, a pharmacy, a viewpoint), so listing what to keep would mean
 * silently losing anything OpenMapTiles adds in a future planet build.
 */
const NOISE_CLASSES = new Set(["office"]);

/** Everything else the tiles name — a bank, a school, a bus stop. Reachable by typing its name,
 *  never by pressing a chip, which is the same stance the Overpass path takes on `place`. */
export function categoryForPoiClass(klass: string): PlaceCategory {
  return CLASS_TO_CATEGORY[klass] ?? "place";
}

/**
 * The prefix that says "this came from a tile, not from a provider".
 *
 * Encoded in the id rather than carried as a field because the id is the one thing that has to
 * survive anyway: `addedDays` is keyed by it, so the row's "Added · Day 3" badge depends on the
 * same place producing the same id across a re-search. Rounded to five decimals — ~1m, far finer
 * than two POIs ever sit apart and coarse enough that the same venue in two adjacent tiles lands
 * on one key.
 */
export const TILE_ID_PREFIX = "tile:";

/** Five decimals of a degree is about a metre. Also the dedupe key's resolution — see above. */
const COORD_PRECISION = 5;

/** What a 320px list can present without becoming a scroll-hunt — the same cap `placeSearch.ts`
 *  puts on an Overpass answer, so the two paths fill the list to the same depth. */
const MAX_RESULTS = 15;

/**
 * Accent-folded lowercase, so typing "gelateria nice" finds "Gelatería Nice".
 *
 * The Overpass path gets this for free — its regex runs against OSM's own name with `i`, and a
 * traveller typing into a Latin keyboard usually types the accented name's unaccented spelling.
 * Here the comparison is ours to make, so the folding is too.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    // The combining-marks block, written as escapes: the literal characters are invisible in an
    // editor and one stray paste turns this into a regex that silently matches nothing.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface TileSearchRequest {
  /** Where the camera is looking — results come back nearest-first from here. */
  centre: LatLng;
  /** Free text, matched as a substring of either name. Empty means "whatever the chips say". */
  query?: string;
  /** The chips, as a union. Empty means every category, which is what a free-text search wants. */
  categories?: PlaceCategory[];
  /** The same buffered hull the Overpass path sends as `poly:`. Fewer than three points is "no
   *  shape", and then the tiles' own coverage is the bound — which is roughly the visible map. */
  area?: LatLng[];
}

/**
 * Tile POIs → the same `FoundPlace` list the search endpoint returns.
 *
 * Deliberately pure and in its own module, for the reason `cardAnchor.ts` gives: the failure mode
 * is silent. A class that maps to the wrong chip, or a dedupe key that is one decimal too coarse,
 * does not throw — it quietly returns a slightly wrong list that looks plausible.
 *
 * Nearest-first rather than by `rank`. `rank` is OpenMapTiles' within-tile importance and has no
 * equivalent on the Overpass side; ordering by it would make the same search return a visibly
 * different list depending on which index answered, and "nearest" is what the panel's copy
 * promises ("Search near this view…").
 */
export function placesFromTiles(
  pois: TilePoi[],
  { centre, query, categories = [], area }: TileSearchRequest
): FoundPlace[] {
  const needle = query?.trim() ? fold(query.trim()) : null;
  const wanted = categories.length ? new Set<PlaceCategory>(categories) : null;
  const bounded = area && area.length >= 3 ? area : null;

  const byKey = new Map<string, { place: FoundPlace; distanceM: number }>();

  for (const poi of pois) {
    if (!poi.name) continue;
    if (NOISE_CLASSES.has(poi.klass)) continue;

    const category = categoryForPoiClass(poi.klass);
    if (wanted && !wanted.has(category)) continue;

    if (needle && !fold(poi.name).includes(needle) && !fold(poi.nameLatin ?? "").includes(needle)) {
      continue;
    }

    if (bounded && !pointInPolygon({ lat: poi.lat, lng: poi.lng }, bounded)) continue;

    // The dedupe that makes this usable at all. `querySourceFeatures` reads every renderable tile,
    // and the `poi` layer is buffered past each tile's edge, so a venue near a boundary arrives
    // once per tile that overlaps it. `tilePlaceId` is what makes the key survive that — see its
    // note for why the name is in there alongside the rounded coordinate.
    const place = placeFromTilePoi(poi);
    if (byKey.has(place.id)) continue;

    byKey.set(place.id, {
      distanceM: metresBetween(centre, { lat: poi.lat, lng: poi.lng }),
      place,
    });
  }

  return [...byKey.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.place);
}

/**
 * The id a tile POI gets, and the one thing two code paths must agree on exactly.
 *
 * `placesFromTiles` mints it for a searched place; the basemap-click path mints it for a place
 * nobody searched for. `addedDays` and `tileFacts` are both keyed by it, so a divergence does not
 * throw — it silently stops "Added · Day 3" appearing on a row the traveler just added, and makes
 * the card re-fetch facts it already has. Hence one function rather than two call sites that look
 * alike.
 *
 * Rounded to five decimals — ~1m, far finer than two POIs ever sit apart, and coarse enough that
 * the same venue arriving in two adjacent tiles lands on one key. The name is in the key too,
 * because two POIs can legitimately share a doorway (a café inside a museum).
 */
export function tilePlaceId(name: string, lat: number, lng: number): string {
  return `${TILE_ID_PREFIX}${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}:${name}`;
}

/** One tile POI as the panel's own shape. Shared by the search and the basemap click for the same
 *  reason `tilePlaceId` is — see its note. */
export function placeFromTilePoi(poi: TilePoi): FoundPlace {
  return {
    id: tilePlaceId(poi.name, poi.lat, poi.lng),
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    category: categoryForPoiClass(poi.klass),
  };
}

/** True for an id `placesFromTiles` minted — the card's cue that its facts have to be fetched. */
export function isTilePlace(place: { id: string }): boolean {
  return place.id.startsWith(TILE_ID_PREFIX);
}
