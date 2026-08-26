import type { TransportMode, TravelLeg } from "./types";

const EARTH_RADIUS_KM = 6371;

/** Door-to-door averages, not vehicle top speeds — they absorb the waiting, transfers and
 *  last-leg walking that straight-line distance can't see. Deliberately conservative, since
 *  a plan that under-books travel time strands the traveler mid-day. */
const SPEED_KMH: Record<TransportMode, number> = {
  walk: 4.5,
  transit: 18,
  drive: 30,
};

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
  if (availableModes.includes("transit")) return "transit";
  if (availableModes.includes("drive")) return "drive";
  return availableModes[0] ?? "walk";
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
      const distanceKm = haversineKm(pois[i], pois[j]) * ROUTE_CIRCUITY_FACTOR;
      const mode = pickMode(distanceKm, availableModes);
      legs.push({
        from: pois[i].name,
        to: pois[j].name,
        mode,
        distanceKm: Math.round(distanceKm * 10) / 10,
        minutes: Math.max(Math.round((distanceKm / SPEED_KMH[mode]) * 60), 1),
        estimated: true,
      });
    }
  }
  return legs;
}

/** Single leg between two coordinates, for the export renderer which builds legs
 *  on the fly from a day's stops. */
export function travelLegBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): Omit<TravelLeg, "from" | "to"> {
  const distanceKm = haversineKm(a, b) * ROUTE_CIRCUITY_FACTOR;
  const mode = pickMode(distanceKm, ["walk", "transit"]);
  return {
    mode,
    distanceKm: Math.round(distanceKm * 10) / 10,
    minutes: Math.max(Math.round((distanceKm / SPEED_KMH[mode]) * 60), 1),
    estimated: true,
  };
}
