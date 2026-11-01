import { haversineKm } from "./travelTime";

/**
 * Whether a stop's coordinate belongs to the trip it is going into, and the fix when the reason it
 * doesn't is a typo.
 *
 * A model writing a coordinate drops a sign or swaps the pair often enough to matter, and nothing
 * downstream notices: the stop saves, its pin lands at sea, and the film flies there. Porto's
 * "Coffee near Se" came back at 41.145, +8.612, about 1,400km out, and only plan health's travel
 * check said anything.
 *
 * **Measured against the nearest known point, not a centre.** A trip can span cities, so "far from
 * the middle" would refuse the second city's stops; "far from everything already in the trip" is
 * what a typo looks like and a real plan never does.
 */
export type CoordCheck = { kind: "ok" } | { kind: "fixed"; lat: number; lng: number } | { kind: "far" };

/** Near enough a known point to be taken as written. */
const NEAR_KM = 100;
/** How close a corrected point must land to be believed over the one written. */
const FIX_KM = 25;
/** Past this from everything in the trip, and with no correction, it is not this trip's. Lisbon from
 *  Porto is ~275km, a long day out but a real one. */
const FAR_KM = 500;

export function checkStopCoord(
  point: { lat?: number; lng?: number },
  known: { lat: number; lon: number }[]
): CoordCheck {
  const { lat, lng } = point;
  if (typeof lat !== "number" || typeof lng !== "number") return { kind: "ok" };
  const valid = (la: number, lo: number) => Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  if (known.length === 0) return valid(lat, lng) ? { kind: "ok" } : { kind: "far" };

  const nearest = (la: number, lo: number) => Math.min(...known.map((k) => haversineKm({ lat: la, lon: lo }, k)));
  const written = valid(lat, lng) ? nearest(lat, lng) : Infinity;
  if (written <= NEAR_KM) return { kind: "ok" };

  // The typos a model makes: one sign dropped, both dropped, or the pair the wrong way round.
  const candidates: [number, number][] = [[lat, -lng], [-lat, lng], [-lat, -lng], [lng, lat], [-lng, lat], [lng, -lat]];
  let best: { lat: number; lng: number; km: number } | null = null;
  for (const [la, lo] of candidates) {
    if (!valid(la, lo)) continue;
    const km = nearest(la, lo);
    if (!best || km < best.km) best = { lat: la, lng: lo, km };
  }
  if (best && best.km <= FIX_KM) return { kind: "fixed", lat: best.lat, lng: best.lng };
  return written > FAR_KM ? { kind: "far" } : { kind: "ok" };
}

/** Every finite stop position in these days, as reference points for `checkStopCoord`. */
export function knownPoints(days: { stops: { lat?: number; lng?: number }[] }[]): { lat: number; lon: number }[] {
  return days.flatMap((d) =>
    d.stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => ({ lat: s.lat as number, lon: s.lng as number }))
  );
}

/**
 * Put back the typo'd coordinates in a set of stops, in place, against the known points. For the
 * paths that keep a model's coordinate when no listing matched (generation's placing sweep, the
 * import). A point no correction brings near is left as written: those paths have no op to refuse,
 * and plan health's travel check already names the leg it breaks.
 */
export function fixTypoCoords(stops: { lat?: number; lng?: number }[], known: { lat: number; lon: number }[]): number {
  let fixed = 0;
  for (const stop of stops) {
    const check = checkStopCoord(stop, known);
    if (check.kind !== "fixed") continue;
    stop.lat = check.lat;
    stop.lng = check.lng;
    fixed++;
  }
  return fixed;
}
