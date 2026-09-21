import { metresBetween } from "../../peekRange";
import { namesAPlace, placeQuery } from "../../placeQuery";
import { allEntries } from "../parseItinerary";
import type { ParsedEntry, ParsedItinerary } from "../parseItinerary";

/**
 * Are the stops where the plan says they are?
 *
 * **Every other scorer here is blind to this, and deliberately so.** `scoreGeoCoherence` and the
 * route scorers resolve a stop through `findPoi(name, knownPois(fixture))` and use the *fixture's*
 * coordinate, which is the right call for measuring whether a day's shape is walkable — it stops a
 * bad coordinate from being scored twice. The only scorer that reads the model's own `lat`/`lng` is
 * `scoreFormat`'s "every stop has coordinates", and that checks presence, not truth. So a stop
 * carrying a confidently wrong coordinate scores clean everywhere.
 *
 * Measured on one real nine-day plan: 49 stops on 39 distinct points, **ten sharing the Pienza town
 * centre** — every breakfast across all nine days, plus the car rental and a lunch — and "Breakfast
 * at Caffè Poliziano" pinned 8.4km from Caffè Poliziano, in the wrong town. Nothing in the
 * benchmark moved.
 *
 * **The signal is collision, not distance, because distance needs a gazetteer and collision does
 * not.** Two stops that name two *different* venues cannot both be at one point; when they are, at
 * least one coordinate is the area's rather than the venue's, which is exactly the defect
 * `FOOD_STOP_INSTRUCTION` and the skill's §3b now warn against. That makes this pure, free, offline
 * and runnable over plans already on disk — no key, no quota, and no second geocoder whose misses
 * would have to be told apart from the model's.
 *
 * What it therefore does NOT catch: a lone stop that is simply in the wrong place, and a whole plan
 * shifted off by a constant. Both need a real gazetteer. Add one when somebody needs the metres.
 */

/**
 * Nearer than this and two stops are one point.
 *
 * Not a round number picked for looking like one: it is `StopResolution.minCorrectionM`, already
 * the value this codebase chose for "a move this small changes nothing on screen". Exact equality
 * would be simpler and is what the raw defect looked like, but it is defeated by a model that
 * jitters the last decimal — and the prompt now asking for the venue's own position makes
 * near-identical centroids the likelier failure.
 */
const SAME_POINT_M = 50;

export interface CoordinateCollision {
  lat: number;
  lng: number;
  /** The distinct venues that cannot all be standing here. */
  venues: string[];
}

export interface CoordinateScore {
  /** Stops carrying a usable coordinate. */
  located: number;
  /** Of those, the ones whose name identifies a particular venue rather than an area or a kind. */
  named: number;
  /** Distinct venues sharing a point with a different venue. */
  colliding: number;
  /** Most stops on any one point, named or not. Diagnostic only — an area legitimately repeats. */
  maxCluster: number;
  collisions: CoordinateCollision[];
  /** 1 when no venue shares a point with another; null when no stop named a venue at all. */
  normalized: number | null;
}

interface Located {
  name: string;
  lat: number;
  lng: number;
  venue: string | null;
}

/** Lowercased, unaccented, punctuation-free, single-spaced — so `Caffè` and `caffe` compare equal. */
function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words that put a stop in an area rather than at an address.
 *
 * `placeQuery` splits on these *and* on "at", because for its job — what string to hand a geocoder
 * — they are all just separators. Here they are not: "at" commits to a venue, while "in"/"around"/
 * "near" are the skill's own way of saying the coordinate is the area's. Reusing its separator set
 * wholesale reported the repaired plan as broken, so this narrower list is the point of the
 * function, not a copy of that one.
 */
const AREA_SEPARATORS = /\b(around|near|in)\b/i;

/**
 * The venue a stop names, or null when nothing about it claims a particular address.
 *
 * Three exclusions, each of which produced a false positive on a *repaired* plan before it existed
 * — and a false positive is the expensive kind here, because the whole use of this scorer is to be
 * believed when it says a plan is wrong:
 *
 *  - **An area separator.** "Farewell lunch in Pienza" and "Lunch around Corso il Rossellino" name
 *    a town and a street. Both are *supposed* to share the centre with their neighbours.
 *  - **A transit leg.** "Private taxi to Montalcino" names its destination but is standing at the
 *    pickup, so it collides with the town centre by construction. Its category already says so.
 *  - **A vague name**, via `namesAPlace` — "caseificio", "Pienza centro".
 *
 * Erring toward `null` costs recall: a real venue skipped here is a collision not reported. That is
 * the right way to be wrong, and it is why `normalized` is a floor on the damage rather than a
 * measurement of it.
 */
function venueOf(entry: ParsedEntry): string | null {
  if (entry.category === "transit") return null;
  if (AREA_SEPARATORS.test(entry.name)) return null;
  const query = placeQuery(entry.name);
  return query && namesAPlace(query) ? query : null;
}

/**
 * Stops grouped into shared points.
 *
 * ponytail: O(n²) single-link, fine to a few hundred stops (`MAX_TRIP_DAYS` is 30); swap for a grid
 * index if a plan ever gets long enough to notice.
 */
function cluster(entries: Located[]): Located[][] {
  const groups: Located[][] = [];
  for (const entry of entries) {
    const hit = groups.find((g) => g.some((m) => metresBetween(m, entry) <= SAME_POINT_M));
    if (hit) hit.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

/**
 * Venue names with the repeats folded away, keeping the shortest spelling of each.
 *
 * "Lunch around Corso il Rossellino" and "Shopping on Corso il Rossellino" are two stops on one
 * street and *should* share a point — only the first has a lead-in to strip, so they arrive here as
 * different strings and containment is what tells them they are the same place.
 */
function distinctVenues(names: string[]): string[] {
  const kept: string[] = [];
  for (const name of names) {
    const folded = normalise(name);
    const at = kept.findIndex((k) => {
      const other = normalise(k);
      return other.includes(folded) || folded.includes(other);
    });
    if (at === -1) kept.push(name);
    else if (normalise(kept[at]).length > folded.length) kept[at] = name;
  }
  return kept;
}

export function scoreCoordinates(itinerary: ParsedItinerary): CoordinateScore {
  const located: Located[] = allEntries(itinerary)
    .filter((e) => e.lat !== null && e.lng !== null)
    // (0,0) is this codebase's "no coordinate" sentinel, not a point in the Gulf of Guinea —
    // `routeStops` drops it for the same reason.
    .filter((e) => !(e.lat === 0 && e.lng === 0))
    .map((e) => ({ name: e.name, lat: e.lat as number, lng: e.lng as number, venue: venueOf(e) }));

  if (located.length === 0) {
    return { located: 0, named: 0, colliding: 0, maxCluster: 0, collisions: [], normalized: null };
  }

  const collisions: CoordinateCollision[] = [];
  let colliding = 0;

  const groups = cluster(located);
  for (const group of groups) {
    const venues = distinctVenues(
      group.map((m) => m.venue).filter((v): v is string => v !== null)
    );
    if (venues.length < 2) continue;
    colliding += venues.length;
    collisions.push({ lat: group[0].lat, lng: group[0].lng, venues });
  }

  // The denominator is named *stops*, the numerator distinct colliding *venues* — folding only ever
  // removes names, and the groups are disjoint, so the ratio stays inside [0, 1].
  const named = located.filter((m) => m.venue !== null).length;

  return {
    located: located.length,
    named,
    colliding,
    maxCluster: Math.max(...groups.map((g) => g.length)),
    collisions,
    normalized: named === 0 ? null : 1 - colliding / named,
  };
}
