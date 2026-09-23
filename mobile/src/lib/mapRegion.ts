/** The four numbers `react-native-maps` frames a map with. Declared here, not imported, so this
 *  module stays pure and reachable from jest without a native mock. */
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type Placeable = { lat: number; lng: number };

/**
 * The narrowest box a day can be framed in.
 *
 * 400m, from the Swift app's `Framing.mapKitMinSpanM`. A day with one stop has a span of zero and
 * a day with two stops ten metres apart has very nearly zero — without a floor both frame a
 * rooftop, which tells a reader nothing about where they are. Real days run from 82m to 67km, so
 * only the bottom of that range needs defending; the top takes care of itself.
 */
const MIN_SPAN_M = 400;

/** Breathing room around the stops, in place of the `edgePadding` a docked panel would need. */
const PAD = 1.35;

const METRES_PER_DEGREE = 111_320;

/**
 * A stop worth drawing.
 *
 * The backend guarantees finite coordinates — `itineraryRejection` 400s a placeless stop at both
 * writers and `normalizeDays` drops one on read — so this is a boundary guard, not a repair. It
 * earns its place anyway because of what a bad value does here: `(0, 0)` is finite and passes
 * every type check, and one null-island stop stretches the box to hemisphere scale and renders
 * the real day as a single pixel. That reads as a broken map rather than a bad coordinate.
 */
function placeable(stop: Placeable): boolean {
  return (
    Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && (stop.lat !== 0 || stop.lng !== 0)
  );
}

/**
 * Keeps each stop's position in the day beside it.
 *
 * **Filter without this and the ordinals silently renumber.** A marker's index in the filtered
 * array is not the stop's index in the day, so a tap would emphasise the wrong row — with nothing
 * to show that it had.
 */
export function drawableStops<T extends Placeable>(stops: T[]): { stop: T; index: number }[] {
  return stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => placeable(stop));
}

/**
 * The region that frames a day's stops, or `null` when it has none to frame.
 *
 * `null` rather than a default region over the destination: an empty day is legitimate, and a map
 * of nowhere is worse than saying the day is open.
 */
export function regionForStops(stops: Placeable[]): Region | null {
  const drawn = stops.filter(placeable);
  if (drawn.length === 0) return null;

  const lats = drawn.map((stop) => stop.lat);
  const lngs = drawn.map((stop) => stop.lng);
  const latitude = (Math.min(...lats) + Math.max(...lats)) / 2;
  const longitude = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const minLatDelta = MIN_SPAN_M / METRES_PER_DEGREE;
  // A degree of longitude shrinks with the cosine of latitude, so the same 400m is a wider span
  // in degrees the further from the equator you are. Clamped because cos(90°) is 0.
  const minLngDelta = minLatDelta / Math.max(0.01, Math.cos((latitude * Math.PI) / 180));

  return {
    latitude,
    longitude,
    latitudeDelta: Math.max((Math.max(...lats) - Math.min(...lats)) * PAD, minLatDelta),
    longitudeDelta: Math.max((Math.max(...lngs) - Math.min(...lngs)) * PAD, minLngDelta),
  };
}
