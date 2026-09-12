import { DEFAULT_MODES, haversineKm, travelLegBetween } from "./travelTime";
import { TTL, cached } from "./fetchCache";
import type { TransportMode, TravelLeg } from "./types";

/**
 * Real road-network routes from the FOSSGIS OSRM deployment — distance, duration and the
 * street-following geometry between two points.
 *
 * **This supersedes `routeMatrix.ts`, and the objection it recorded was correct about the host it
 * was written about.** That module evaluated `router.project-osrm.org`, OSRM's public *demo*
 * server, and found it served driving-speed numbers under the walking and cycling profile names —
 * so it could not honestly back a walking estimate, and it was removed. That finding stands.
 *
 * `routing.openstreetmap.de` is a different deployment: a **separate backend per profile**, which
 * is why the profile appears in the host segment (`routed-foot`) and not only in the path.
 * Measured live, Louvre → Palais-Royal (`2.3364,48.8606` → `2.3376,48.8656`):
 *
 * | profile | distance | duration | implied speed |
 * |---------|----------|----------|---------------|
 * | foot    |   640.6m |   512.1s |      4.5 km/h |
 * | bike    |   941.3m |   403.4s |      8.4 km/h |
 * | car     |  1629.9m |   292.2s |     20.1 km/h |
 *
 * The distances differ, not just the divisors — the foot route cuts through pedestrian streets the
 * car route has to drive around. That is the evidence the demo host could not produce. Reproduce it
 * with:
 *
 * ```
 * curl -s "https://routing.openstreetmap.de/routed-foot/route/v1/foot/2.3364,48.8606;2.3376,48.8656?overview=false"
 * ```
 *
 * If a future check shows three identical distances, this file's premise has failed and the
 * minutes it produces must stop being presented as measured. That is the check worth keeping.
 *
 * **Server-only.** It reaches `fetchCache.ts` and therefore `better-sqlite3` — see the note at the
 * top of `serverFetchCached.ts` for what importing this from the client graph would do. The client
 * reaches it through `GET /api/route`.
 *
 * **What it deliberately does not do.** No transit: FOSSGIS serves foot, bike and car, and no free
 * transit router exists (see `probeTransitAvailable` below). No multi-waypoint requests — OSRM
 * accepts them, but a per-leg cache key survives the reorder that a per-day key does not, and a
 * reorder is this app's most common edit. No alternatives, and no turn-by-turn `steps`: nothing
 * above this renders either.
 */

// --- The pure core ---
//
// Everything above the network line is deterministic and exported solely so `osrmRoute.test.mjs`
// can reach it — `npm test` opens no socket. That split matters more here than usual: **every
// guard lives in `osrmUrl`**, not in the fetch below it, so the suite can prove that a bad mode, a
// bad coordinate or an absurd distance never becomes a request at all.

/** The `{lat, lon}` this repo's server-side modules use. Note `lon`, not the map layer's `lng`. */
export interface Pt {
  lat: number;
  lon: number;
}

/** The three modes FOSSGIS can answer for. `transit` is absent because nothing serves it. */
export type RoutableMode = Extract<TransportMode, "walk" | "bike" | "drive">;

export interface OsrmRoute {
  /** Metres along the road network, as OSRM reports them — unrounded. */
  distanceM: number;
  /** Seconds, as OSRM reports them — unrounded. */
  durationS: number;
  /** The street-following line, in the map layer's `{lat, lng}`. OSRM emits GeoJSON `[lon, lat]`;
   *  **this module is the only place that flip happens**. Empty when the response carried numbers
   *  but no readable geometry — the planner wants the numbers and the map degrades to its arcs. */
  geometry: { lat: number; lng: number }[];
}

/**
 * Host segment and profile segment, and they are **not** symmetric: `routed-car` serves `driving`,
 * not `car`. Verified live; making the pair uniform is a 400 from the host, and it looks exactly
 * like the kind of inconsistency someone tidies up.
 */
const PROFILES: Record<RoutableMode, { host: string; profile: string }> = {
  walk: { host: "routed-foot", profile: "foot" },
  bike: { host: "routed-bike", profile: "bike" },
  drive: { host: "routed-car", profile: "driving" },
};

/**
 * The longest leg worth asking about, in kilometres.
 *
 * 150 rather than the 600 a general-purpose proxy would pick, because this is a day planner: it
 * covers a real day excursion (Paris → Giverny is 75km, Tokyo → Hakone 90km) with headroom and
 * nothing beyond. It is also what makes a response-size cap unnecessary — `overview=full` on a leg
 * this short cannot produce a payload worth streaming and measuring.
 */
export const MAX_LEG_KM = 150;

/** The mode OSRM can serve, or `null` for one it cannot. */
export function routableMode(mode: TransportMode): RoutableMode | null {
  return mode in PROFILES ? (mode as RoutableMode) : null;
}

function validCoord(p: Pt): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}

/**
 * The request URL for one leg, or `null` when the leg must not be requested at all.
 *
 * Returning `null` rather than throwing is what lets every guard sit here instead of in
 * `fetchRoute`: a rejected leg costs no socket, no timeout and no cache row, and the test suite
 * can prove each rejection without a network stub. The three rejections:
 *
 * - a mode OSRM has no profile for (`transit`),
 * - a coordinate that is not a finite number in range — including the `0` a missing query
 *   parameter turns into, which is a legal point in the Gulf of Guinea,
 * - a leg longer than `MAX_LEG_KM`, which is not a request anyone should be able to make of a
 *   free community server from a query string.
 */
export function osrmUrl(a: Pt, b: Pt, mode: TransportMode): string | null {
  const routable = routableMode(mode);
  if (!routable) return null;
  if (!validCoord(a) || !validCoord(b)) return null;
  if (haversineKm(a, b) > MAX_LEG_KM) return null;

  const { host, profile } = PROFILES[routable];
  // OSRM takes `lon,lat` — the reverse of every other coordinate in this repo. Reversed, a Paris
  // leg routes off the coast of Africa and returns a plausible-looking answer rather than an error.
  const coords = `${a.lon},${a.lat};${b.lon},${b.lat}`;
  return (
    `https://routing.openstreetmap.de/${host}/route/v1/${profile}/${coords}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`
  );
}

/**
 * The `fetch_cache` key for one leg.
 *
 * 4dp (~11m), not the 2dp (~1.1km) the city-scale sources use: a door-to-door route is a
 * tight-radius question, and a kilometre of key slop would serve the route to the wrong side of a
 * river. The coordinates reaching here are OSM-corrected and stable, so 4dp still shares a row
 * between two trips visiting the same landmark.
 *
 * **Direction is deliberately not normalised.** `a→b` and `b→a` are different routes on the car
 * profile, and often on foot too — one-way streets, barriers, stairs. Folding them into one key
 * looks like a free doubling of the hit rate and is a wrong answer half the time.
 */
export function routeCacheKey(a: Pt, b: Pt, mode: RoutableMode): string {
  const f = (n: number) => n.toFixed(4);
  return `osrm:${PROFILES[mode].profile}:${f(a.lat)},${f(a.lon)}:${f(b.lat)},${f(b.lon)}`;
}

/**
 * OSRM's reply, reduced to what this app uses — or `null` for anything that is not a usable route.
 *
 * `null` covers a non-`Ok` code (`NoRoute` for a pair with no path between them) and a response
 * whose numbers are missing or unparseable. The distance/duration check is not defensive padding:
 * a route object present but without a finite `duration` would otherwise produce `NaN` minutes,
 * which propagates silently through every arithmetic consumer downstream and renders as "NaN min".
 *
 * Geometry is the one part allowed to be absent — numbers without a line are still a useful
 * answer, so an unreadable `coordinates` degrades to `[]` rather than failing the whole parse.
 */
export function parseOsrmRoute(raw: unknown): OsrmRoute | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { code?: unknown; routes?: unknown };
  if (body.code !== "Ok") return null;
  if (!Array.isArray(body.routes) || body.routes.length === 0) return null;

  const route = body.routes[0] as { distance?: unknown; duration?: unknown; geometry?: unknown };
  const distanceM = route?.distance;
  const durationS = route?.duration;
  if (typeof distanceM !== "number" || !Number.isFinite(distanceM)) return null;
  if (typeof durationS !== "number" || !Number.isFinite(durationS)) return null;

  const coordinates = (route.geometry as { coordinates?: unknown } | undefined)?.coordinates;
  const geometry: { lat: number; lng: number }[] = [];
  if (Array.isArray(coordinates)) {
    for (const pair of coordinates) {
      // `[lon, lat]` in, `{lat, lng}` out. See `osrmUrl` for what getting this backwards looks
      // like — no crash, a line drawn into the sea.
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [lon, lat] = pair as [unknown, unknown];
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      geometry.push({ lat, lng: lon });
    }
  }

  return { distanceM, durationS, geometry };
}

/**
 * Whether the destination has public transit. Still unproven, and still deliberately `false`.
 *
 * It lives here, three lines below `PROFILES`, for the reason its previous home stopped being
 * trustworthy: as a lone stub in `routeMatrix.ts` its justification was a paragraph about a host
 * nothing in the repo called any more, and it went stale without anyone noticing. Beside the
 * profile table the argument is checkable at a glance — FOSSGIS serves foot, bike and car, there
 * is no fourth row, and no free source publishes the equivalent for buses. Operators publish their
 * own dock coordinates, which is why `bikeshare.ts` could answer the bike half of
 * `RawFetch.transportModes` and why nothing can answer this half.
 *
 * A negative result means **"not proven"**, not "no transit" — which is why `reconcile.ts` degrades
 * to an assumed walk plus transit rather than planning a car-only city.
 */
export async function probeTransitAvailable(): Promise<boolean> {
  return false;
}

// --- The network path ---

/** Generous, and it is queue wait rather than transfer: the payload for a capped leg is small.
 *  Matches the reference implementation this was modelled on. */
const OSRM_TIMEOUT_MS = 12_000;

/** FOSSGIS's usage policy asks callers to identify themselves. Same string `overpass.ts` sends,
 *  and for the same reason — these are free community instances that can and do drop traffic they
 *  cannot attribute. */
const HEADERS = { "User-Agent": "TripMate/1.0" } as const;

/** How many legs are in flight at once, and how long a whole batch may take.
 *
 *  Together with the 90-day cache these *are* the outbound rate limit for the server path: a cold
 *  trip walks its legs four at a time and a warm one asks for nothing at all.
 *  ponytail: fixed chunking. A token bucket only earns its keep once a second caller exists. */
const BATCH_CONCURRENCY = 4;
const BATCH_BUDGET_MS = 15_000;

async function fetchOsrm(url: string, signal: AbortSignal): Promise<OsrmRoute | null> {
  try {
    const res = await fetch(url, { signal, headers: HEADERS });
    if (!res.ok) return null;
    // Parsed before it is cached, not stored raw: the numbers and the line are what every caller
    // wants, and `overview=full`'s vertex list is far larger than the shape it reduces to.
    return parseOsrmRoute(await res.json());
  } catch {
    // A timeout aborts, which throws, which lands here — the same shape as any other network
    // failure and therefore the same fail-soft path. See `holidays.ts` for the original argument.
    return null;
  }
}

/**
 * One leg's real route, or `null` when we could not answer.
 *
 * **`null` is the single failure channel**, and that is a deliberate narrowing rather than lost
 * information. A timeout, a 500, a guard rejection and OSRM's own `NoRoute` all mean the identical
 * thing to every consumer — fall back to the haversine estimate — so a second channel would be a
 * distinction nobody branches on. Compare `poiDetails.ts`, which *does* keep `null` separate from
 * `{}`, because there "asked and matched nothing" is a useful answer to render differently.
 *
 * It must never be rendered as "these places are unreachable", the same way `bikeshare.ts`'s `null`
 * must never render as "this city has no bikeshare".
 *
 * Collapsing `NoRoute` into `null` also buys a guard for free: `cached()` never writes a `null`, so
 * a pair that genuinely has no path is re-asked rather than frozen as a fact for ninety days.
 */
export async function fetchRoute(
  a: Pt,
  b: Pt,
  mode: TransportMode,
  opts: { signal?: AbortSignal } = {}
): Promise<OsrmRoute | null> {
  const url = osrmUrl(a, b, mode);
  if (!url) return null;
  // Non-null because `osrmUrl` already returned a URL, which it only does for a routable mode.
  const routable = routableMode(mode)!;

  const timeout = AbortSignal.timeout(OSRM_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  return cached(routeCacheKey(a, b, routable), TTL.STATIC, () => fetchOsrm(url, signal));
}

/**
 * Route many legs at once. Index-aligned in, index-aligned out — a leg that could not be answered
 * is `null` in its own slot, so callers match results to inputs by position and never by a key
 * convention this module would have had to invent.
 *
 * One shared deadline across the whole batch rather than one per leg, so a caller's worst case is
 * `budgetMs` regardless of how many legs it hands over. Legs already in `fetch_cache` cost nothing
 * against it.
 */
export async function routeLegs(
  legs: { from: Pt; to: Pt; mode: TransportMode }[],
  opts: { budgetMs?: number } = {}
): Promise<(OsrmRoute | null)[]> {
  if (legs.length === 0) return [];
  const signal = AbortSignal.timeout(opts.budgetMs ?? BATCH_BUDGET_MS);

  const out: (OsrmRoute | null)[] = [];
  for (let i = 0; i < legs.length; i += BATCH_CONCURRENCY) {
    const group = legs.slice(i, i + BATCH_CONCURRENCY);
    out.push(...(await Promise.all(group.map((l) => fetchRoute(l.from, l.to, l.mode, { signal })))));
  }
  return out;
}

/**
 * Route a list of point pairs, choosing each one's mode the way the estimate already does.
 *
 * **The mode is picked before routing and is not revised afterwards**, which is the rule worth
 * stating once rather than rediscovering. `travelLegBetween`'s choice is about traveller comfort
 * thresholds — 1.5km on foot, 8km on a bike where one exists — so a road turning out longer than
 * the crow's flight is not a reason to put somebody on a train. Routing answers *how long this
 * mode takes*, not *which mode*.
 *
 * **A transit leg is `null` and always will be.** There is no free transit router, and the
 * tempting hybrid — OSRM's foot distance divided by the transit speed constant — is rejected on
 * purpose. A measured distance under an assumed speed produces a number that *looks* verified and
 * is not, which is precisely the dishonesty `routeMatrix.ts` was written about. It would be worse
 * than the estimate it replaced, because the estimate at least admits what it is.
 *
 * No separate cap on how many pairs may be passed: `routeLegs`'s shared batch deadline already
 * bounds the caller's worst case however many there are, and `BATCH_CONCURRENCY` bounds the burst.
 */
export async function routePairs(
  pairs: { from: Pt; to: Pt }[],
  modes: TransportMode[] = DEFAULT_MODES,
  opts: { budgetMs?: number } = {}
): Promise<(OsrmRoute | null)[]> {
  return routeLegs(
    pairs.map(({ from, to }) => ({ from, to, mode: travelLegBetween(from, to, modes).mode })),
    opts
  );
}

/** Minutes for a route, rounded exactly as `travelLegBetween` rounds its estimate — including the
 *  floor at 1, so a 40-second walk reads the same whichever produced it. Two roundings of the same
 *  quantity is how a real leg and an estimated one start disagreeing by a minute for no reason. */
export function routeMinutes(route: OsrmRoute): number {
  return Math.max(Math.round(route.durationS / 60), 1);
}

/** Kilometres to 1dp, matching `TravelLeg.distanceKm` and `travelLegBetween`. See `routeMinutes`. */
export function routeDistanceKm(route: OsrmRoute): number {
  return Math.round(route.distanceM / 100) / 10;
}

/**
 * Upgrade estimated legs to measured ones wherever OSRM could answer.
 *
 * Index-aligned in, index-aligned out. A leg that could not be routed comes back **unchanged**,
 * `estimated: true` still on it — so the result is always a complete set of legs and a caller never
 * has to reason about holes.
 *
 * Deliberately a separate pass rather than an option on `buildTravelLegs`. That function is
 * synchronous, pure and reachable from four `"use client"` components through `schedule.ts`;
 * threading a network call into it would drag `fetchCache.ts` and `better-sqlite3` into the client
 * bundle, which is the trap `serverFetchCached.ts` exists to document. It also has to keep working
 * on its own — it is the fallback.
 *
 * `pointByName` is how a leg's two endpoints are found, because `TravelLeg` identifies them by
 * name. A leg naming a place absent from the map is left estimated rather than guessed at.
 *
 * **Mixed output is the normal case, not a degraded one.** With the default modes, `pickMode` picks
 * `transit` for anything past 1.5km and nothing routes transit, so a typical trip comes back with
 * its short hops measured and its long ones estimated. `routed`/`routable` are returned so the
 * caller can say which happened without recounting.
 */
export async function applyRealRoutes(
  legs: TravelLeg[],
  pointByName: Map<string, Pt>,
  opts: { budgetMs?: number } = {}
): Promise<{ legs: TravelLeg[]; routed: number; routable: number }> {
  // Only legs whose mode OSRM serves and whose endpoints we can place are worth asking about;
  // `routable` counts those, so "3 of 4" never counts a transit leg as a failure.
  const candidates = legs.map((leg, index) => {
    const from = pointByName.get(leg.from);
    const to = pointByName.get(leg.to);
    return routableMode(leg.mode) && from && to ? { index, from, to, mode: leg.mode } : null;
  });
  const asked = candidates.filter((c): c is NonNullable<typeof c> => c !== null);
  if (asked.length === 0) return { legs, routed: 0, routable: 0 };

  const routes = await routeLegs(asked, opts);
  const next = [...legs];
  let routed = 0;
  routes.forEach((route, i) => {
    if (!route) return;
    routed += 1;
    const { index } = asked[i];
    next[index] = {
      ...legs[index],
      distanceKm: routeDistanceKm(route),
      minutes: routeMinutes(route),
      estimated: false,
    };
  });
  return { legs: next, routed, routable: asked.length };
}
