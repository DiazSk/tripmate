// Relative, not the `@/lib` alias. `scripts/ts-resolve.mjs` only retries *relative* specifiers, so
// one aliased import here is enough to make this whole module — and anything importing it —
// unreachable from a `.test.mjs`. That is not hypothetical: it is how `searchPalette.test.mjs`
// broke the moment this line was added, since it reads `PLACE_CATEGORIES` from here.
import { enclosingCircle, pointInPolygon, type LatLng } from "./searchArea";
/**
 * "What cafés are around here?" — the lookup behind the map's search control.
 *
 * **Two providers, one shape.** Google Places answers when `GOOGLE_PLACES_API_KEY` is set;
 * OpenStreetMap through Overpass answers when it is not, which today is always. That is not a
 * hedge — it is the only way to ship the feature against this repo's actual configuration. Google
 * Places requires a key *and* a billing account, and every other data source here clears the bar
 * CLAUDE.md sets ("all free; one needs a key"). Overpass is already a dependency, already carries
 * this app's two other OSM lookups, and is genuinely good at exactly this question: `amenity=cafe`
 * is a first-class tag with far better small-venue coverage than a paid attractions API.
 *
 * Add the key and the same control starts returning Google's results, with its ratings and its
 * addresses, without a line changing above this file.
 *
 * Fail-soft throughout, the house convention: a rate limit, a timeout or a missing key returns an
 * empty list and a provider name, never an error the traveler cannot act on. The caller shows
 * "nothing found here", which is a true statement either way.
 */

import { askOverpass } from "./overpass";

export interface FoundPlace {
  /** Stable within one result set — used as a React key and to match a pin to a row. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** The kind of place, already normalised to this app's own category names. */
  category: PlaceCategory;
  /** Street address, when the provider has one. Google usually does, OSM often does not. */
  address?: string;
  /** 0-5, when the provider has one. OSM has no ratings at all. */
  rating?: number;
}

/**
 * The categories the control offers.
 *
 * Deliberately short. A picker with forty options is a taxonomy the traveler has to learn; these
 * are the six things somebody actually goes looking for while reading a day plan, and free text
 * covers the rest.
 */
export const PLACE_CATEGORIES = [
  "cafe",
  "restaurant",
  "bar",
  "museum",
  "park",
  "shop",
] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number] | "place";

/** How each category is asked for, per provider. */
const OSM_FILTERS: Record<Exclude<PlaceCategory, "place">, string> = {
  cafe: '["amenity"~"^(cafe|ice_cream)$"]',
  restaurant: '["amenity"~"^(restaurant|fast_food)$"]',
  bar: '["amenity"~"^(bar|pub|biergarten)$"]',
  museum: '["tourism"~"^(museum|gallery)$"]',
  park: '["leisure"~"^(park|garden)$"]',
  shop: '["shop"]',
};

const GOOGLE_TYPES: Record<Exclude<PlaceCategory, "place">, string> = {
  cafe: "cafe",
  restaurant: "restaurant",
  bar: "bar",
  museum: "museum",
  park: "park",
  shop: "store",
};

/**
 * Overpass endpoints, tried in order.
 *
 * More than one, and that is not belt-and-braces. A search box generates exactly the traffic a
 * shared community instance rate-limits — several queries per session, each covering a
 * neighbourhood — and being turned away is the *ordinary* case rather than the exceptional one.
 * Measured while building this: a session's worth of testing was enough for `overpass-api.de` to
 * start refusing connections outright, at which point the feature is correct, honest and useless.
 *
 * The mirrors run the same software over the same planet data, so failing across them costs
 * nothing but a little latency.
 *
 * That failover lives in `overpass.ts` now, shared with the other four callers. The note that
 * stood here — that `roads.ts` and `cityBoundary.ts` "fire once per destination, which is nothing
 * like this", so they could stay on the primary alone — was right about rate limiting and wrong
 * about availability: firing once at a host that is down fails every time, not rarely. See
 * `overpass.ts` for the measurement that settled it.
 */
/** Longer than the other upstreams because Overpass queues under load. The `[timeout:N]` inside
 *  the query is Overpass's own budget; this is the wall clock on the request carrying it. */
const OVERPASS_TIMEOUT_MS = 25_000;
const GOOGLE_TIMEOUT_MS = 10_000;
/** Default search radius. A walk, not a city — the question is "what is near where I am looking". */
export const DEFAULT_SEARCH_RADIUS_M = 1800;
/** Hard cap on what comes back. Fifteen is what a 320px list can present without becoming a
 *  scroll-hunt, and it is also the point past which an Overpass answer stops being worth the
 *  bytes: the results are ordered nearest-first, so the sixteenth is by construction the least
 *  relevant thing in the area. */
const MAX_RESULTS = 15;

export interface PlaceSearchRequest {
  lat: number;
  lng: number;
  /**
   * The area to search, as a ring of coordinates — the buffered hull of what the traveler can see
   * (`searchArea.ts`). Optional: without it the search falls back to `radiusM` around `lat`/`lng`,
   * which is what every non-map caller wants and what this endpoint did before.
   *
   * **Both providers end up honouring it, by different routes.** Overpass takes a `poly:` filter
   * natively. Google takes a circle and nothing else, so it is given the polygon's enclosing
   * circle and its answers are then filtered back to the shape here — otherwise the two providers
   * would return visibly different areas for the same request.
   */
  area?: LatLng[];
  /** Free text. Matched against the name; ignored by the category-only path when empty. */
  query?: string;
  /**
   * Categories to search, as a union — cafés *and* bars, not cafés narrowed by bars.
   *
   * Was a single optional category. Multi-select made the plural the real shape: a traveler
   * planning an evening wants bars and restaurants on the map at once, and running that as two
   * sequential searches would both double the load on a rate-limited shared index and make the
   * second answer replace the first. Empty or absent means "every category this control offers",
   * which is what a free-text search wants.
   */
  categories?: PlaceCategory[];
  radiusM?: number;
}

export interface PlaceSearchResult {
  provider: "google" | "osm";
  places: FoundPlace[];
  /**
   * False when the provider could not be reached at all — a timeout, a rate limit, a refused
   * connection.
   *
   * The house distinction, and it earns its keep here more than almost anywhere else in this app:
   * `[]` with `available: true` means *this neighbourhood has no cafés*, and `[]` with
   * `available: false` means *we could not ask*. A search box is the one surface where those two
   * are constantly confused, because a public Overpass instance rate-limits exactly the traffic a
   * search box generates — and "nothing found" is a lie the traveler will act on by giving up.
   */
  available: boolean;
}

export async function searchPlaces(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key) {
    const places = await searchGoogle(request, key);
    // A Google failure falls through to OSM rather than returning nothing. The traveler asked a
    // question; a quota error is our problem, not theirs.
    if (places && places.length > 0) return { provider: "google", places, available: true };
  }
  const places = await searchOverpass(request);
  return { provider: "osm", places: places ?? [], available: places !== null };
}

/**
 * Google Places API (New) — `searchText` when there are words to search, `searchNearby` when the
 * traveler only picked a category.
 *
 * The field mask is not optional and is not decoration: the New API bills per requested field
 * class, and asking for the default set on a browse-style search is a straightforward way to spend
 * money on data nothing renders.
 */
async function searchGoogle(
  { lat, lng, query, categories, radiusM = DEFAULT_SEARCH_RADIUS_M, area }: PlaceSearchRequest,
  key: string
): Promise<FoundPlace[] | null> {
  const text = query?.trim();
  // Google has no polygon input, so the shape becomes the smallest circle containing it and the
  // results are trimmed back to the real area below. Over-asking is the safe direction: a circle
  // inscribed *inside* the polygon would silently miss the corners.
  const circle = area?.length ? enclosingCircle(area) : null;
  const originLat = circle?.lat ?? lat;
  const originLng = circle?.lng ?? lng;
  const searchRadiusM = circle ? Math.min(Math.max(circle.radiusM, 200), 50_000) : radiusM;
  const endpoint = text
    ? "https://places.googleapis.com/v1/places:searchText"
    : "https://places.googleapis.com/v1/places:searchNearby";
  const body: Record<string, unknown> = {
    maxResultCount: MAX_RESULTS,
    locationBias: {
      circle: { center: { latitude: originLat, longitude: originLng }, radius: searchRadiusM },
    },
  };
  // Both this field and the `Accept-Language` header below are set: the header covers the
  // transport and
  // `languageCode` is what the Places v1 body documents, and which of the two wins has changed
  // between API revisions. Setting both costs nothing and is stable across either.
  body.languageCode = PREFERRED_LANGUAGE;
  if (text) body.textQuery = text;
  else {
    // `searchNearby` takes a hard restriction rather than a bias, and no free text.
    delete body.locationBias;
    body.locationRestriction = {
      circle: { center: { latitude: originLat, longitude: originLng }, radius: searchRadiusM },
    };
    // Every selected category in one call. `includedTypes` is already a list — the single-element
    // array this used to build was the only thing making it a single-category search.
    const picked = (categories ?? []).filter(
      (c): c is Exclude<PlaceCategory, "place"> => c !== "place" && c in GOOGLE_TYPES
    );
    body.includedTypes = (picked.length
      ? picked
      : (Object.keys(GOOGLE_TYPES) as Exclude<PlaceCategory, "place">[])
    ).map((c) => GOOGLE_TYPES[c]);
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.primaryType",
        // Names and addresses in English. Without it the API answers in the language of the place
        // — 京都国立博物館, Museo del Novecento — which is correct data and unreadable next to an
        // English itinerary. Google falls back to the local name when it has no English one, so
        // this never blanks a result, it only prefers a translation where one exists.
        "Accept-Language": PREFERRED_LANGUAGE,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: {
        id?: string;
        displayName?: { text?: string };
        location?: { latitude?: number; longitude?: number };
        formattedAddress?: string;
        rating?: number;
        primaryType?: string;
      }[];
    };
    return (data.places ?? [])
      .filter((p) => p.displayName?.text && p.location)
      // Back to the shape that was actually asked for. Without this the Google path answers with a
      // circle's worth of results while the OSM path answers with the polygon's, and which one a
      // traveler got would depend on whether a key happened to be configured.
      .filter(
        (p) =>
          !area?.length ||
          pointInPolygon({ lat: p.location!.latitude!, lng: p.location!.longitude! }, area)
      )
      .map((p) => ({
        id: p.id ?? `${p.location!.latitude},${p.location!.longitude}`,
        name: p.displayName!.text!,
        lat: p.location!.latitude!,
        lng: p.location!.longitude!,
        category: normaliseGoogleType(p.primaryType),
        address: p.formattedAddress,
        rating: p.rating,
      }));
  } catch {
    return null;
  }
}

function normaliseGoogleType(type: string | undefined, fallback?: PlaceCategory): PlaceCategory {
  if (!type) return fallback ?? "place";
  const match = (Object.keys(GOOGLE_TYPES) as Exclude<PlaceCategory, "place">[]).find((c) =>
    type.includes(GOOGLE_TYPES[c])
  );
  return match ?? fallback ?? "place";
}

/**
 * OpenStreetMap through Overpass.
 *
 * `nwr` rather than `node`, because a café is a node in one city and a building outline in the
 * next — asking only for nodes silently loses every venue somebody bothered to draw. `out center`
 * then gives ways and relations a single coordinate, which is what a map pin and a `Stop` both
 * need.
 *
 * Free text is a **case-insensitive name match inside the same query** rather than a filter over
 * the results: Overpass is being asked to look through a whole neighbourhood, and pulling every
 * café within 1.8km back over the wire to grep it locally would be slower and ruder.
 */
async function searchOverpass({
  lat,
  lng,
  area,
  query,
  categories,
  radiusM = DEFAULT_SEARCH_RADIUS_M,
}: PlaceSearchRequest): Promise<FoundPlace[] | null> {
  const text = query?.trim();
  // `poly:` when there is a shape, `around:` when there is not. Overpass wants the ring as
  // space-separated `lat lon` pairs in one string, and it must not repeat the first point at the
  // end — the server closes the ring itself and a duplicate vertex is a parse error.
  const around = area?.length
    ? `(poly:"${area.map((p) => `${p.lat.toFixed(6)} ${p.lng.toFixed(6)}`).join(" ")}")`
    : `(around:${Math.round(radiusM)},${lat},${lng})`;
  // Escaped for the Overpass regex literal, which is delimited by double quotes.
  // Matched against **every** name tag this search can render, not just `name`. Overpass's
  // `[~"keyRegex"~"valueRegex"]` form is what makes that one filter rather than a second set of
  // clauses. Without it, typing "Kyoto National Museum" in Kyoto matches nothing at all: the venue
  // is tagged `name=京都国立博物館` with the English only on `name:en`, so the list the traveler is
  // reading — which this change makes English — could not be searched in the language it is
  // written in.
  const nameFilter = text
    ? `[~"^(name|name:en|int_name)$"~"${escapeForOverpassRegex(text)}",i]`
    : "";

  // With a category, ask for that category. Without one, ask for the union of every category the
  // control offers — which is what "search by name" should mean: any of these kinds of place
  // whose name matches, not every tagged object in the neighbourhood.
  const chosen = (categories ?? []).filter(
    (c): c is Exclude<PlaceCategory, "place"> => c !== "place" && c in OSM_FILTERS
  );
  const selectors = chosen.length ? chosen.map((c) => OSM_FILTERS[c]) : Object.values(OSM_FILTERS);
  const clauses = selectors.map((f) => `nwr${f}${nameFilter}${around};`).join("");
  const body = `[out:json][timeout:20];(${clauses});out center ${MAX_RESULTS * 3};`;

  const elements = await askOverpass(body, { timeoutMs: OVERPASS_TIMEOUT_MS });
  if (elements === null) return null;

  const seen = new Set<string>();
  const places: FoundPlace[] = [];
  for (const el of elements) {
    const name = englishName(el.tags);
    const lat2 = el.lat ?? el.center?.lat;
    const lon2 = el.lon ?? el.center?.lon;
    if (!name || lat2 === undefined || lon2 === undefined) continue;
    // Overpass returns the same venue once per matching selector when several apply — a pub that
    // is also tagged as a restaurant, say. Keyed on name *and* position, so two branches of one
    // chain on the same street both survive.
    const key = `${name}@${lat2.toFixed(5)},${lon2.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      id: `${el.type}/${el.id}`,
      name,
      lat: lat2,
      lng: lon2,
      // No fallback category any more. With one selected category the request *was* the answer,
      // so falling back to it was right; with several, the tags are the only thing that says which
      // of them this venue is — and that answer is now what picks the pin's colour.
      category: categoryFromTags(el.tags ?? {}),
      address: addressFromTags(el.tags ?? {}),
    });
    if (places.length >= MAX_RESULTS) break;
  }
  // Nearest first. Overpass returns in element-id order, which is an accident of when somebody
  // added the venue to OSM and means nothing to somebody looking at a map.
  return places.sort(
    (a, b) => (a.lat - lat) ** 2 + (a.lng - lng) ** 2 - ((b.lat - lat) ** 2 + (b.lng - lng) ** 2)
  );
}

/**
 * Make a traveler's typed words safe inside an Overpass regex literal.
 *
 * Two escapes, not one. The quote and backslash are dropped because the literal is delimited by
 * double quotes inside a query built by string concatenation — leaving them in is how a search box
 * becomes a query injection. The regex metacharacters are then backslash-escaped so that typing
 * `Cafe (old town)` searches for that text rather than failing to compile as a group.
 */
function escapeForOverpassRegex(text: string): string {
  return text.replace(/["\\]/g, "").replace(/[.*+?^${}()|[\]]/g, "\\$&");
}

/**
 * Put one query to the mirrors until something answers.
 *
 * `null` only when every one of them failed, which is the "we could not ask" the caller reports as
 * such. A 429 (rate limit) or a 504 (the server's own queue timing out) is a reason to try the
 * next mirror, not a reason to tell the traveler their neighbourhood has no cafés.
 */


function categoryFromTags(tags: Record<string, string>, fallback?: PlaceCategory): PlaceCategory {
  const amenity = tags.amenity ?? "";
  if (amenity === "cafe" || amenity === "ice_cream") return "cafe";
  if (amenity === "restaurant" || amenity === "fast_food") return "restaurant";
  if (amenity === "bar" || amenity === "pub" || amenity === "biergarten") return "bar";
  if (tags.tourism === "museum" || tags.tourism === "gallery") return "museum";
  if (tags.leisure === "park" || tags.leisure === "garden") return "park";
  if (tags.shop) return "shop";
  return fallback ?? "place";
}

/** House number and street, when OSM has both. Anything less is not an address worth showing. */
/**
 * The language search results are asked for and rendered in.
 *
 * The itinerary around this panel is written in English, and a result list that answers half in
 * Japanese is not bilingual, it is unreadable — the traveler cannot match "京都国立博物館" against
 * the "Kyoto National Museum" three lines above it in their own plan. Both providers can be asked
 * for English and both fall back to the local name when there is no English one, so this never
 * costs a result; it only prefers a translation where the data has one.
 */
const PREFERRED_LANGUAGE = "en";

/**
 * An OSM element's name, in English where OSM has one.
 *
 * Three tags in priority order, and the order is the interesting part. `name:en` is an actual
 * English name and always wins. `int_name` is the "international" name, which in practice is a
 * romanisation — "Kiyomizu-dera" rather than "Pure Water Temple" — and is the right second choice,
 * because a romanised name is at least pronounceable and matchable against a plan written in
 * English. `name` is the local-language default and the last resort, which is what the panel showed
 * for every result before this existed.
 *
 * Deliberately *not* a transliteration of `name` when all three are missing: guessing a romanisation
 * client-side gets Japanese and Arabic wrong in ways that look authoritative, and an unfamiliar
 * script the traveler can at least photograph and match is better than a confident mistransliteration.
 */
function englishName(tags: Record<string, string> | undefined): string | undefined {
  if (!tags) return undefined;
  const candidate = tags["name:en"] ?? tags.int_name ?? tags.name;
  return candidate?.trim() || undefined;
}

function addressFromTags(tags: Record<string, string>): string | undefined {
  const street = tags["addr:street"];
  if (!street) return undefined;
  const number = tags["addr:housenumber"];
  return number ? `${number} ${street}` : street;
}
