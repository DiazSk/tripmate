/**
 * Airports and mainline rail stations near a destination, from OSM via Overpass.
 *
 * Exists so the arrive/depart fields can offer real places to pick from. A traveler planning their
 * first trip to Kyoto does not know it is served by Kansai (81km out) as well as Itami (39km), and
 * where a city has two airports the choice decides what day 1 can hold — Haneda is 18km from
 * central Tokyo and Narita 63km.
 *
 * Everything here is pure: the query is built, the response is parsed, nothing is fetched. The
 * fetch lives in `app/api/arrival-points/route.ts`. That split is deliberate — this file imports
 * no values, which is the condition for a `.test.mjs` being able to load it at all (see CLAUDE.md),
 * and the parsing below is the part that actually breaks.
 */

export type ArrivalPointKind = "airport" | "rail";

export interface ArrivalPoint {
  /** Display name, with the IATA code appended for airports: "Kansai Intl (KIX)". */
  name: string;
  kind: ArrivalPointKind;
  distanceKm: number;
  /** Sorts before distance. 0 for an international airport, 1 for anything else. */
  tier: number;
  /** Bare code, separate from `name` — a flight search needs "KIX", not the display string it's
   *  embedded in. `null` for rail, and for an airport OSM never tagged (rare, given the query's
   *  own `["iata"]` filter already requires the tag to exist). */
  iata: string | null;
}

/** Two ranges, because the two kinds sit at different distances from the city they serve.
 *
 *  Airports need reach: Kansai is 81km from Kyoto and Narita 60km from Tokyo, so `roads.ts`'s 30km
 *  highway radius — or any round number that feels generous — silently drops the one airport the
 *  traveler actually flew into. That failure is invisible; the dropdown just doesn't list it.
 *
 *  Stations need the opposite. You arrive at the city's own station, and a wide box around Kyoto
 *  pulls in several hundred from across the Kansai region — all of which Overpass has to serialise
 *  and we then throw away. Measured: 50km of stations was 191KB and 273 elements for six results. */
export const AIRPORT_RANGE_KM = 100;
/** Tighter than it looks like it should be, twice over. A 15km box of stations around Tokyo made
 *  Overpass 504 outright, and even filtered to mainline, Paris has 174 inside it — at which point
 *  "nearest to the city centre" is picking near-arbitrarily among them. 8km keeps the query cheap
 *  and keeps the answers central. */
export const STATION_RANGE_KM = 8;

/** Per kind, not overall. A single cap of six sorted airports-first returned six airports for
 *  Kyoto — including a military airbase 109km out — and no Kyoto Station at all. */
export const MAX_AIRPORTS = 3;
export const MAX_STATIONS = 3;

export const MAX_POINTS = MAX_AIRPORTS + MAX_STATIONS;

/** Raw Overpass element. `nwr` returns nodes (`lat`/`lon`) and ways/relations (`center`) in one
 *  response, so both shapes have to be handled — same unwrap `poiDetails.ts` already does. */
export interface OverpassArrivalElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** A bounding box for a range in km, as Overpass wants it: `(south,west,north,east)`.
 *
 *  A box, not `around:`. Measured against the public instance, the `around:` form of this exact
 *  query timed out server-side after 32s — and did so as an HTTP **200** carrying a `remark`,
 *  which is why the route has to check for one. The box uses the spatial index and came back in
 *  18s with the same data.
 *
 *  A box circumscribes its circle, so the corners reach ~1.4x the range. That surplus is trimmed
 *  by real distance in `parseArrivalPoints`, not here — Gifu Airbase, 109km from Kyoto, arrived
 *  through exactly that corner. */
function bbox(lat: number, lon: number, km: number): string {
  const dLat = km / 111;
  // Meridians converge, so a degree of longitude is shorter the further from the equator. Clamped
  // because the divisor goes to zero at the poles.
  const dLon = km / Math.max(111 * Math.cos(lat * (Math.PI / 180)), 1);
  return `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
}

/**
 * One union query, not one request per kind.
 *
 * `poiDetails.ts` records the reason: twelve separate clauses at 30km returned a 504 in nine
 * seconds, where the union came back in one round trip.
 *
 * `["iata"]` is what makes the airport clause useful — without it OSM's `aeroway=aerodrome`
 * includes airstrips, heliports and flying clubs, none of which anyone arrives on holiday through.
 * `["military"!~"."]` (Overpass for "this key is absent") is the other half: an IATA code does not
 * mean passenger service. Yokota Air Base and Atsugi both carry one, and both are nearer to Tokyo
 * than Narita — so on distance alone they took two of the three airport slots and Narita took
 * none.
 *
 * `["train"="yes"]` is the equivalent for rail, and it is doing two jobs. It separates mainline
 * stations from metro and tram stops — around Kyoto it selects 4 of 37, and the one it wants is
 * there — and it is what makes the clause affordable at all: unfiltered, Tokyo 504'd. Measured as
 * well populated outside Japan (Paris returns Gare de Lyon and Montparnasse through it).
 *
 * No bus clause. It cost a third of the query for a case nobody has: a traveler flying into a
 * foreign city does not begin their holiday by naming its bus station.
 */
export function buildArrivalPointsQuery(lat: number, lon: number): string {
  const wide = bbox(lat, lon, AIRPORT_RANGE_KM);
  const near = bbox(lat, lon, STATION_RANGE_KM);
  return (
    `[out:json][timeout:25];(` +
    `nwr["aeroway"="aerodrome"]["iata"]["military"!~"."](${wide});` +
    `nwr["railway"="station"]["train"="yes"]["name"](${near});` +
    `);out center tags;`
  );
}

function kindOf(tags: Record<string, string>): ArrivalPointKind | null {
  if (tags.aeroway === "aerodrome") return "airport";
  if (tags.railway === "station") return "rail";
  return null;
}

/** Airports first even when they're the farthest thing in the list — someone filling in "where do
 *  you arrive" on an international trip means the airport, and burying it under four commuter
 *  stations because those are nearer would be sorting by the wrong thing. */
const KIND_RANK: Record<ArrivalPointKind, number> = { airport: 0, rail: 1 };

/** How much farther a better-tier airport may reach before distance wins instead — see the sort
 *  in `parseArrivalPoints` for the measured cases this separates. */
const MAX_TIER_OVERRIDE_KM = 25;

/** Distance is the wrong first sort for airports, and the failure is specific: Charles de Gaulle
 *  is 23km from central Paris while Le Bourget (business aviation) is 13km and Villacoublay
 *  (military) 15km, so ranking on distance alone dropped CDG off a three-slot list. OSM marks the
 *  distinction, so use it — international first, then everything else, then distance within each.
 *
 *  "International" from OSM's own `aerodrome`/`aerodrome:type` tag is necessary but not
 *  sufficient, and the failure this time was the opposite of Le Bourget's: Seattle's Boeing
 *  Field — a general-aviation field with almost no scheduled passenger service — carries
 *  `aerodrome:type=international` because its *official* name is "King County International
 *  Airport", and beat the real Sea-Tac on distance (9km vs 18km) the same way Le Bourget nearly
 *  beat CDG. Verified live against OSM: Boeing Field has that tag and nothing else; Sea-Tac,
 *  Heathrow and Charles de Gaulle all additionally carry a `rank_aci:*` tag — Airports Council
 *  International's own top-world-airports-by-passenger-volume ranking, imported for genuinely
 *  busy hubs and absent from Boeing Field and Le Bourget alike. That tag is the tie-break: a
 *  hub with real passenger volume outranks one that merely has "international" in its paperwork.
 */
function airportTier(tags: Record<string, string>): number {
  if (Object.keys(tags).some((k) => k.startsWith("rank_aci"))) return 0;
  if (/international/i.test(`${tags.aerodrome ?? ""} ${tags["aerodrome:type"] ?? ""}`)) return 1;
  return 2;
}

/** How far out each kind is still plausibly the place someone arrived. */
const RANGE_KM: Record<ArrivalPointKind, number> = {
  airport: AIRPORT_RANGE_KM,
  rail: STATION_RANGE_KM,
};

// ponytail: third copy of haversine in this repo (travelTime.ts, poiDetails.ts). Kept local so
// this module has no value imports and stays loadable from a .test.mjs — consolidating all three
// into a shared geo module is the fix, once something can import it without that cost.
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Overpass elements → a ranked shortlist.
 *
 * Returns `[]` for an empty response, which is a real answer ("nowhere near here") and distinct
 * from the `null` the route returns when the request itself failed.
 */
export function parseArrivalPoints(
  elements: OverpassArrivalElement[],
  origin: { lat: number; lon: number }
): ArrivalPoint[] {
  if (!Array.isArray(elements)) return [];

  const byName = new Map<string, ArrivalPoint>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = kindOf(tags);
    if (!kind) continue;

    // `name:en` first: the traveler is reading this in English, and OSM's `name` is whatever the
    // local language is — "関西国際空港" is not a pickable option for someone who can't read it.
    const base = (tags["name:en"] ?? tags.name ?? "").trim();
    if (!base) continue;

    const point = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;

    // The code is how a traveler recognises an airport on a booking confirmation, so it belongs in
    // the label — but only when the name doesn't already carry it.
    const iata = tags.iata?.trim();
    const name = iata && !base.includes(iata) ? `${base} (${iata})` : base;

    // OSM models a large airport as several elements (a node for the point, a way for the
    // grounds), so the same name arrives more than once. Keep whichever is nearest.
    const existing = byName.get(name);
    const km = distanceKm(origin, point);
    if (!existing || km < existing.distanceKm) {
      const tier = kind === "airport" ? airportTier(tags) : 0;
      byName.set(name, { name, kind, distanceKm: Math.round(km), tier, iata: iata || null });
    }
  }

  const ranked = [...byName.values()]
    // The box is square and the range is a circle, so its corners are out of range by up to 40%.
    .filter((p) => p.distanceKm <= RANGE_KM[p.kind])
    .sort((a, b) => {
      if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (a.kind === "airport" && a.tier !== b.tier) {
        // Tier is only allowed to override distance up to a point — measured live, two
        // opposite failures: CDG (23km) correctly beats Le Bourget (13km, +10km) and Sea-Tac
        // (18km) correctly beats Boeing Field (9km, +9km), but the SAME "prefer the better tier"
        // rule with no cap also picked Boston Logan (79km) over Manchester-Boston Regional
        // (7km, +72km), and Detroit Metro (62km) over Toledo Express (23km, +39km) — both
        // legitimate, real, locally-served airports that simply carry no "international" tag or
        // rank_aci. Past this cap the "better tier" one is plausibly a different city's own
        // airport, not a lesser alternative to the real local hub, so distance decides instead.
        // ponytail: a fixed km cap, not a metro-boundary lookup — a genuine same-metro pair more
        // than this far apart still misfires. Revisit with a real "same urban area" signal if
        // one shows up in OSM broadly; none of `aerodrome`/`aerodrome:type`/`rank_aci` carry it.
        const better = a.tier < b.tier ? a : b;
        const worse = a.tier < b.tier ? b : a;
        if (better.distanceKm - worse.distanceKm <= MAX_TIER_OVERRIDE_KM) return a.tier - b.tier;
      } else if (a.tier !== b.tier) {
        return a.tier - b.tier;
      }
      return a.distanceKm - b.distanceKm;
    });

  // Quotas rather than one cap, so airports cannot crowd out the station the traveler is far more
  // likely to have actually arrived at. Whatever one kind doesn't use, the other may take.
  const airports = ranked.filter((p) => p.kind === "airport");
  const ground = ranked.filter((p) => p.kind !== "airport");
  return [
    ...airports.slice(0, Math.max(MAX_AIRPORTS, MAX_POINTS - ground.length)),
    ...ground.slice(0, Math.max(MAX_STATIONS, MAX_POINTS - airports.length)),
  ].slice(0, MAX_POINTS);
}
