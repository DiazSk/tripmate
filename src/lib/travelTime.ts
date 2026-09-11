import type { TransportMode, TravelLeg } from "./types";

const EARTH_RADIUS_KM = 6371;

/** Door-to-door averages, not vehicle top speeds — they absorb the waiting, transfers and
 *  last-leg walking that straight-line distance can't see. Deliberately conservative, since
 *  a plan that under-books travel time strands the traveler mid-day. */
const SPEED_KMH: Record<TransportMode, number> = {
  walk: 4.5,
  // A shared bike is ridden at ~15km/h, but this number is door to door: it absorbs walking to a
  // dock, unlocking, and finding a free dock at the other end, which is the leg a traveler
  // actually experiences. Deliberately slower than `transit`'s figure even though the riding is
  // faster — transit's 18 is an average over longer hops where the vehicle makes up the waiting.
  bike: 13,
  transit: 18,
  drive: 30,
};

/** Above this, a shared bike stops being the comfortable option for a visitor with a day of
 *  sightseeing ahead — and it is the range where a metro genuinely wins. Below the walk cap the
 *  bike never gets picked at all, because walking a few hundred metres beats docking twice. */
const BIKE_MAX_KM = 8;

/** Straight-line distance ignores road networks, so real routes are longer. This multiplier is
 *  the standard "circuity factor" correction — roughly what a gridded city costs over the crow's
 *  flight. Still an estimate: every leg it produces is flagged `estimated: true`. */
const ROUTE_CIRCUITY_FACTOR = 1.3;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Walk up to ~1.5km, transit beyond that — the point where walking stops being the faster
 *  door-to-door option once waiting and transfers are priced in. `drive` is only ever chosen
 *  when the destination has no transit mode available. */
function pickMode(distanceKm: number, availableModes: TransportMode[]): TransportMode {
  if (distanceKm <= 1.5 && availableModes.includes("walk")) return "walk";
  // Between the walk cap and `BIKE_MAX_KM`, a shared bike beats waiting for a train — but only
  // where one demonstrably exists. `"bike"` reaches this list solely from a resolved GBFS system
  // (see `bikeshare.ts`), never from `DEFAULT_MODES`, so this branch is inert in a city without
  // one and every existing leg is priced exactly as before.
  if (distanceKm <= BIKE_MAX_KM && availableModes.includes("bike")) return "bike";
  if (availableModes.includes("transit")) return "transit";
  if (availableModes.includes("drive")) return "drive";
  return availableModes[0] ?? "walk";
}

/** Modes to assume when nothing has told us what the destination actually offers. Walk + transit
 *  is the city default; `drive` is only ever picked when transit is explicitly absent. */
export const DEFAULT_MODES: TransportMode[] = ["walk", "transit"];

/**
 * One leg between two points — the single place the tuned constants above are applied.
 *
 * Extracted from `buildTravelLegs` so the drag-and-drop re-scheduler can price a consecutive
 * hop without either recomputing the whole pairwise matrix or re-declaring the speeds and
 * circuity factor next to it (two copies of a tuned constant is one copy too many).
 */
export function travelLegBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  availableModes: TransportMode[] = DEFAULT_MODES
): { mode: TransportMode; distanceKm: number; minutes: number } {
  const distanceKm = haversineKm(a, b) * ROUTE_CIRCUITY_FACTOR;
  const mode = pickMode(distanceKm, availableModes);
  return {
    mode,
    distanceKm: Math.round(distanceKm * 10) / 10,
    minutes: Math.max(Math.round((distanceKm / SPEED_KMH[mode]) * 60), 1),
  };
}

/** Pairwise legs between every POI, for the clustering/sequencing later steps do. Pure local
 *  math — no network call, so it has no failure mode and needs no fail-soft path. */
export function buildTravelLegs(
  pois: { name: string; lat: number; lon: number }[],
  availableModes: TransportMode[]
): TravelLeg[] {
  const legs: TravelLeg[] = [];
  for (let i = 0; i < pois.length; i++) {
    for (let j = i + 1; j < pois.length; j++) {
      const leg = travelLegBetween(pois[i], pois[j], availableModes);
      legs.push({ from: pois[i].name, to: pois[j].name, estimated: true, ...leg });
    }
  }
  return legs;
}
