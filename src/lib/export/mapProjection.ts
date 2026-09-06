/**
 * Web Mercator, bounds and viewBox fitting for the exported itinerary's offline map.
 *
 * Pure by design — no fetch, no DOM, no engine. `mapRenderer.ts`'s `project()` is the app's
 * equivalent, but both implementations of it need a live viewer, which an export does not have.
 *
 * Mercator rather than the plate carrée `projectToMap()` in `blue-hour/worldLand.ts`: that one is
 * fixed to a 1200x480 world frame and stretches horizontally by 1/cos(lat), which is 1.22x at
 * Kyoto and 2x at Oslo. Wrong enough to see on a city map where the whole point is recognising
 * the shape of streets you are standing in.
 */

/** The latitude Mercator is conventionally cut at, where y reaches 0 and 1. */
export const MERCATOR_MAX_LAT = 85.051129;

/** Equatorial circumference, metres. Same constant as `peekRange.ts`, which duplicates it for the
 *  same reason: staying importable from a `.test.mjs` matters more than a shared module here. */
export const EQUATOR_M = 40_075_016.686;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * A projected window onto the world, in normalized Mercator, plus the SVG user-space box it maps
 * onto. `x0`/`y0` are the top-left corner of the window; note y grows *southward* in Mercator, so
 * `y0` is the projection of `maxLat`.
 */
export interface MapFrame {
  width: number;
  height: number;
  x0: number;
  y0: number;
  spanX: number;
  spanY: number;
  /** SVG user units per real-world metre, at the frame's centre latitude. Sizes the GPS accuracy
   *  circle, which is the only thing here that is specified in metres. */
  unitsPerMetre: number;
}

/** The SVG user-space box every frame is fitted to. The map scales with CSS, so these are mostly
 *  the units path coordinates get rounded against — but the *ratio* is real: the map is pinned to
 *  the top of the viewport while a day is open, so a squarer frame would eat the room the day's
 *  stops need to scroll in. 1.72:1 is header-shaped without cropping anything. */
export const VIEW = { width: 1000, height: 580 } as const;

/**
 * A stop is usable if it actually carries coordinates. `Stop.lat`/`Stop.lng` are declared required,
 * but itineraries saved before a given field existed routinely violate the declared types (see
 * `normalizeDays` in `itinerary.ts`, which backfills some fields and not others), and a model can
 * emit a stop with no coordinates at all.
 *
 * (0, 0) is rejected as a pair rather than testing `lat === 0` alone — Null Island is the shape a
 * missing coordinate takes, but the equator is not: Quito sits at -0.18 and Kampala at 0.31.
 */
export function isUsableCoord(point: Partial<LatLng> | null | undefined): point is LatLng {
  if (!point) return false;
  const { lat, lng } = point;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** Normalized Web Mercator: x and y both in [0, 1], y increasing southward. */
export function mercatorXY(lat: number, lng: number): { x: number; y: number } {
  const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2,
  };
}

export function boundsOf(points: (Partial<LatLng> | null | undefined)[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const point of points) {
    if (!isUsableCoord(point)) continue;
    if (!bounds) {
      bounds = { minLat: point.lat, maxLat: point.lat, minLng: point.lng, maxLng: point.lng };
      continue;
    }
    bounds.minLat = Math.min(bounds.minLat, point.lat);
    bounds.maxLat = Math.max(bounds.maxLat, point.lat);
    bounds.minLng = Math.min(bounds.minLng, point.lng);
    bounds.maxLng = Math.max(bounds.maxLng, point.lng);
  }
  return bounds;
}

/** Grows `bounds` by `fraction` of its own span on every side, so pins never sit on the edge. */
export function padBounds(bounds: Bounds, fraction: number): Bounds {
  const latPad = (bounds.maxLat - bounds.minLat) * fraction;
  const lngPad = (bounds.maxLng - bounds.minLng) * fraction;
  return {
    minLat: Math.max(-90, bounds.minLat - latPad),
    maxLat: Math.min(90, bounds.maxLat + latPad),
    minLng: Math.max(-180, bounds.minLng - lngPad),
    maxLng: Math.min(180, bounds.maxLng + lngPad),
  };
}

/** Great-circle diagonal of a bounds, km. Decides city mode vs region mode. */
export function boundsDiagonalKm(bounds: Bounds): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bounds.maxLat - bounds.minLat);
  const dLng = toRad(bounds.maxLng - bounds.minLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(bounds.minLat)) * Math.cos(toRad(bounds.maxLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Fits `bounds` into `VIEW`, widening the short axis so the frame matches the view's aspect ratio
 * rather than squashing the projection. A degenerate bounds — one stop, or several at the same
 * address — is expanded to `minSpanDeg` first, or the frame would have zero area and every
 * projected point would land on NaN.
 */
export function fitFrame(bounds: Bounds, minSpanDeg = 0.004): MapFrame {
  let { minLat, maxLat, minLng, maxLng } = bounds;

  if (maxLat - minLat < minSpanDeg) {
    const mid = (maxLat + minLat) / 2;
    minLat = mid - minSpanDeg / 2;
    maxLat = mid + minSpanDeg / 2;
  }
  if (maxLng - minLng < minSpanDeg) {
    const mid = (maxLng + minLng) / 2;
    minLng = mid - minSpanDeg / 2;
    maxLng = mid + minSpanDeg / 2;
  }

  const topLeft = mercatorXY(maxLat, minLng);
  const bottomRight = mercatorXY(minLat, maxLng);

  let x0 = topLeft.x;
  let y0 = topLeft.y;
  let spanX = bottomRight.x - x0;
  let spanY = bottomRight.y - y0;

  // Match the view's aspect by growing the deficient axis about the centre. Growing rather than
  // cropping keeps every stop inside the frame, which is the one thing the fit must guarantee.
  const viewAspect = VIEW.width / VIEW.height;
  if (spanX / spanY < viewAspect) {
    const want = spanY * viewAspect;
    x0 -= (want - spanX) / 2;
    spanX = want;
  } else {
    const want = spanX / viewAspect;
    y0 -= (want - spanY) / 2;
    spanY = want;
  }

  // Mercator compresses ground distance toward the poles by cos(lat), so metres-per-unit has to be
  // taken at the frame's own centre rather than at the equator.
  const centreLat = (minLat + maxLat) / 2;
  const metresPerUnit = EQUATOR_M * Math.cos((centreLat * Math.PI) / 180);
  const unitsPerMetre = VIEW.width / spanX / metresPerUnit;

  return { width: VIEW.width, height: VIEW.height, x0, y0, spanX, spanY, unitsPerMetre };
}

/** Projects a coordinate into `frame`'s SVG user space. Points outside the frame return values
 *  outside [0, width] — callers that care (the GPS dot) clamp; paths are clipped by the viewBox. */
export function projectToFrame(lat: number, lng: number, frame: MapFrame): { x: number; y: number } {
  const { x, y } = mercatorXY(lat, lng);
  return {
    x: ((x - frame.x0) / frame.spanX) * frame.width,
    y: ((y - frame.y0) / frame.spanY) * frame.height,
  };
}

/** Mercator, inverted. The Overpass bbox is derived from the *fitted* frame rather than from the
 *  raw stop bounds, so roads reach the frame's corners instead of stopping where the pins do. */
export function inverseMercator(x: number, y: number): LatLng {
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
    lng: x * 360 - 180,
  };
}

/** The lat/lng box a frame actually shows. */
export function frameBounds(frame: MapFrame): Bounds {
  const topLeft = inverseMercator(frame.x0, frame.y0);
  const bottomRight = inverseMercator(frame.x0 + frame.spanX, frame.y0 + frame.spanY);
  return {
    minLat: bottomRight.lat,
    maxLat: topLeft.lat,
    minLng: topLeft.lng,
    maxLng: bottomRight.lng,
  };
}
