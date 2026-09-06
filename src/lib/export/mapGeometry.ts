/**
 * Turning `{lat,lng}[]` polylines into SVG path data small enough to inline.
 *
 * Pure, like `mapProjection.ts`. Everything here runs in *projected* SVG user space rather than in
 * degrees, which is the point: a simplification tolerance only means something visually if it is
 * expressed in the units the thing is finally drawn in. A tolerance in degrees would thin out a
 * high-latitude city far more aggressively than an equatorial one.
 *
 * The three geometry sources this serves all share the `{lat,lng}[]` element shape —
 * `CityBoundary.segments` (`cityBoundary.ts`), Overpass way geometry, and a day's `Stop[]` — so
 * one builder covers boundary, roads, water and route lines.
 */

import { isUsableCoord, projectToFrame, type LatLng, type MapFrame } from "./mapProjection";

export interface Pt {
  x: number;
  y: number;
}

export interface SegmentPath {
  /** An SVG `d` attribute for this one segment: a single `M` followed by `L`s. */
  d: string;
  /** Drawn length in SVG user units. The budget sheds the shortest segments first. */
  lengthUnits: number;
}

/** Squared distance from `p` to the *segment* ab (not the infinite line — clamping at the ends is
 *  what keeps a hairpin from being read as a straight run). */
function perpDistSq(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return (p.x - (a.x + clamped * dx)) ** 2 + (p.y - (a.y + clamped * dy)) ** 2;
}

/**
 * Douglas-Peucker. Iterative with an explicit stack rather than recursive: an OSM way can carry a
 * few thousand nodes, and the recursive form's depth is O(n) on a monotone input — exactly the
 * shape a long straight motorway has.
 *
 * Endpoints are always kept, so a simplified segment still starts and ends where it did.
 */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.slice();

  const tolSq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: number[] = [0, points.length - 1];
  while (stack.length) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    if (last - first < 2) continue;

    let maxSq = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const dist = perpDistSq(points[i], points[first], points[last]);
      if (dist > maxSq) {
        maxSq = dist;
        index = i;
      }
    }

    if (maxSq > tolSq && index > 0) {
      keep[index] = 1;
      stack.push(first, index, index, last);
    }
  }

  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Splits a polyline into the runs that actually touch the frame, keeping one point either side of
 * each crossing so a road still reaches the edge rather than stopping short of it.
 *
 * Necessary because an Overpass bbox query returns every *whole* way that intersects the box: a
 * motorway clipped to a city centre still arrives carrying its full hundred-kilometre geometry.
 * Drawing it is free (the viewBox clips) but serializing it is not, and its untrimmed length
 * would also outrank genuinely central streets in the budget's longest-first ordering.
 */
export function clipRuns(points: Pt[], width: number, height: number, margin: number): Pt[][] {
  const inside = (p: Pt) =>
    p.x >= -margin && p.x <= width + margin && p.y >= -margin && p.y <= height + margin;

  const runs: Pt[][] = [];
  let run: Pt[] = [];

  for (let i = 0; i < points.length; i++) {
    if (inside(points[i])) {
      if (run.length === 0 && i > 0) run.push(points[i - 1]);
      run.push(points[i]);
    } else if (run.length > 0) {
      run.push(points[i]);
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);

  return runs.filter((r) => r.length > 1);
}

/** Drops coordinates that carry no usable position, then projects the rest. */
export function projectSegment(points: (Partial<LatLng> | null | undefined)[], frame: MapFrame): Pt[] {
  const out: Pt[] = [];
  for (const point of points) {
    if (!isUsableCoord(point)) continue;
    out.push(projectToFrame(point.lat, point.lng, frame));
  }
  return out;
}

/** One decimal in a 1000-unit view is well under a rendered pixel at any realistic display size,
 *  and is worth roughly a third of the byte count of the raw 7-decimal coordinates Overpass sends. */
const round = (n: number): number => Math.round(n * 10) / 10;

export function pathOf(points: Pt[]): string {
  if (points.length < 2) return "";

  let lastX = round(points[0].x);
  let lastY = round(points[0].y);
  let d = `M${lastX} ${lastY}`;
  let drawn = 0;

  for (let i = 1; i < points.length; i++) {
    const x = round(points[i].x);
    const y = round(points[i].y);
    // Rounding can collapse neighbouring nodes onto the same point; emitting the duplicate would
    // cost bytes and draw nothing.
    if (x === lastX && y === lastY) continue;
    d += `L${x} ${y}`;
    lastX = x;
    lastY = y;
    drawn++;
  }

  return drawn > 0 ? d : "";
}

export function lengthOf(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Projects, simplifies and serializes every segment, longest first.
 *
 * The ordering is what makes the byte budget degrade gracefully: taking from the front sheds side
 * streets and stubs before arterials, so an over-budget map loses detail rather than structure.
 */
export function segmentPaths(
  segments: (Partial<LatLng> | null | undefined)[][],
  frame: MapFrame,
  tolerance: number,
  clip = true,
): SegmentPath[] {
  const paths: SegmentPath[] = [];

  const margin = frame.width * 0.15;

  for (const segment of segments) {
    const projected = projectSegment(segment, frame);
    // Filled rings are never clipped: a lake split into runs at the frame edge fills as a
    // different shape than the lake. Open lines are, since an Overpass way arrives whole.
    const runs = clip ? clipRuns(projected, frame.width, frame.height, margin) : [projected];
    for (const run of runs) {
      const simplified = simplify(run, tolerance);
      const d = pathOf(simplified);
      if (!d) continue;
      paths.push({ d, lengthUnits: lengthOf(simplified) });
    }
  }

  return paths.sort((a, b) => b.lengthUnits - a.lengthUnits);
}

/** Concatenates segment paths until `maxChars` is reached. Returns `""` rather than a partial
 *  first path, so the result is always valid path data. */
export function joinWithinBudget(paths: SegmentPath[], maxChars: number): string {
  let out = "";
  for (const path of paths) {
    if (out.length + path.d.length > maxChars) break;
    out += path.d;
  }
  return out;
}
