import { metresBetween } from "./peekRange";
import { bearingRad } from "./tourPacing";

/**
 * Walking a camera along a polyline at a steady speed.
 *
 * Pure and DOM-free, so `pathFollow.test.mjs` can prove the one property that matters and cannot be
 * seen by eye on a fast machine: **the camera moves at a constant ground speed regardless of how
 * the vertices are spaced**. An OSRM route is dense through a roundabout and sparse along a
 * straight, so stepping vertex-by-vertex would crawl through junctions and jump down boulevards —
 * which reads as the camera stuttering, not as the route being interesting.
 *
 * The fix is that the driver advances in **metres**, never in vertex index. `cumM` is what makes
 * that a lookup rather than a search.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MeasuredPath {
  points: LatLng[];
  /** Distance from the first point to each point, in metres. Monotonic, `cumM[0] === 0`. */
  cumM: number[];
  totalM: number;
}

/**
 * How far ahead the heading looks, in metres.
 *
 * A heading taken from the current vertex to the next one snaps through 90° at every corner, and a
 * camera that snaps reads as broken rather than as turning. Looking a fixed distance ahead rounds
 * the turn over the approach to it — the same thing a driver does with their eyes — and costs no
 * filter state, no smoothing buffer and no tuning beyond this one number.
 *
 * 60m is about a city block's corner radius: long enough to round a right angle, short enough that
 * a genuine change of direction still registers.
 */
export const HEADING_LOOKAHEAD_M = 60;

/** Cumulative distances along a polyline. Coincident and single-point paths give `totalM === 0`,
 *  which every consumer below handles rather than dividing by. */
export function measurePath(points: readonly LatLng[]): MeasuredPath {
  const cumM: number[] = new Array(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += metresBetween(points[i - 1], points[i]);
    cumM[i] = total;
  }
  return { points: [...points], cumM, totalM: total };
}

export interface PathSample {
  lat: number;
  lng: number;
  /** Radians clockwise from north, along the direction of travel. */
  headingRad: number;
}

/**
 * The point and forward heading `distanceM` along the path, clamped at both ends.
 *
 * `cursor` is the caller's monotonic hint. The driver only ever moves forward, so carrying the last
 * segment index makes this O(1) amortised across a flight; a binary search would be more code for
 * a worse constant. Passing no cursor is correct, just linear.
 */
export function sampleAt(
  path: MeasuredPath,
  distanceM: number,
  cursor?: { i: number }
): PathSample {
  const { points, cumM, totalM } = path;
  if (points.length === 0) return { lat: 0, lng: 0, headingRad: 0 };
  if (points.length === 1 || totalM === 0) {
    return { lat: points[0].lat, lng: points[0].lng, headingRad: 0 };
  }

  const target = Math.min(Math.max(distanceM, 0), totalM);
  const at = positionAt(points, cumM, target, cursor);

  // The heading is measured from where we are to a point ahead, not between two vertices — see
  // HEADING_LOOKAHEAD_M. Near the end the lookahead clamps to the final point, which keeps the
  // last stretch pointing the way it was already going instead of collapsing to zero.
  const aheadTarget = Math.min(target + HEADING_LOOKAHEAD_M, totalM);
  const ahead =
    aheadTarget > target ? positionAt(points, cumM, aheadTarget) : points[points.length - 1];
  const headingRad =
    ahead.lat === at.lat && ahead.lng === at.lng ? 0 : bearingRad(at, ahead);

  return { lat: at.lat, lng: at.lng, headingRad };
}

/** Linear interpolation between the two vertices `target` metres falls between. */
function positionAt(
  points: LatLng[],
  cumM: number[],
  target: number,
  cursor?: { i: number }
): LatLng {
  let i = cursor?.i ?? 0;
  if (i >= points.length - 1) i = points.length - 2;
  // Rewind if the caller went backwards (a replayed beat), then walk forward. Both loops are
  // bounded by the vertex count, so a bad hint costs correctness nothing.
  while (i > 0 && cumM[i] > target) i--;
  while (i < points.length - 2 && cumM[i + 1] < target) i++;
  if (cursor) cursor.i = i;

  const span = cumM[i + 1] - cumM[i];
  const t = span > 0 ? (target - cumM[i]) / span : 0;
  return {
    lat: points[i].lat + (points[i + 1].lat - points[i].lat) * t,
    lng: points[i].lng + (points[i + 1].lng - points[i].lng) * t,
  };
}
