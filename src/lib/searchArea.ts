/**
 * The shape a map search is run inside.
 *
 * The old search was a circle around the camera centre, and a circle is the wrong shape for the
 * question. What the traveler can see is a *tilted rectangle* of ground; what they are reading
 * inside it is a scatter of stops that is usually long and thin — a day that runs along a river,
 * a morning that walks one street. A circle big enough to contain that day also contains several
 * square kilometres of somewhere else, which is both a worse answer and a much heavier query
 * against a shared community Overpass instance.
 *
 * So the area is built in three steps, and each is a separate exported function so each can be
 * tested on its own:
 *
 * 1. **What is visible** — the viewport's ground footprint, supplied by the renderer.
 * 2. **The shape inside it** — the convex hull of the trip's stops that fall in that footprint.
 *    The outermost points joined up, which is exactly what a hull is.
 * 3. **A buffer outward** — a miter offset by a distance measured in kilometres, so the search
 *    reaches the next street over rather than stopping dead on the outermost stop.
 *
 * Everything here works in degrees but measures in metres, with longitude scaled by `cos(lat)`.
 * Over the few kilometres this operates on that is accurate to well under a metre, and it keeps
 * the whole module free of a projection library.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Metres per degree of latitude. Constant enough at this scale. */
const M_PER_DEG_LAT = 111_320;

/** Metres per degree of longitude at a given latitude. */
function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/**
 * How far outward the hull is pushed, in metres.
 *
 * Kilometres rather than metres, deliberately. A buffer of a few hundred metres only reaches the
 * same block the stop is already on, which is the one part of the map the traveler can already
 * see labelled — the point of the buffer is to bring in the *next* neighbourhood, the one they
 * would have to pan to. 1.2km is roughly a fifteen-minute walk.
 */
export const DEFAULT_BUFFER_M = 1200;

/** Beyond this the miter on a very sharp hull corner is truncated. Without a limit, two nearly
 *  collinear edges produce a spike thousands of kilometres long — the standard failure mode of a
 *  naive polygon offset, and one that would send an Overpass query round the planet. */
const MITER_LIMIT = 3;

/** Vertices used when a degenerate hull (one point) has to be turned into an area. */
const CIRCLE_SEGMENTS = 12;

/**
 * Convex hull by Andrew's monotone chain, in O(n log n).
 *
 * Returns the vertices counter-clockwise in (lng, lat) reading, with no repeated final point.
 * Fewer than three input points come back as-is (deduplicated) — a hull of two points is a
 * segment, and `bufferShape` is what turns those into an area.
 *
 * Collinear points are **excluded** (`<= 0` rather than `< 0` in the turn test): they add vertices
 * that carry no shape, and every one of them is another coordinate pair in an Overpass `poly:`
 * filter that has to be parsed and matched against.
 */
export function convexHull(points: LatLng[]): LatLng[] {
  const unique = dedupe(points);
  if (unique.length < 3) return unique;

  // Sorted by lng then lat — the "x then y" of this coordinate space.
  const sorted = [...unique].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: LatLng[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: LatLng[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // Each list's last point is the other's first.
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Two coordinates closer than this are the same place for hull purposes — about 1cm. */
const DEDUPE_EPSILON = 1e-7;

function dedupe(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (
      out.some(
        (q) => Math.abs(q.lat - p.lat) < DEDUPE_EPSILON && Math.abs(q.lng - p.lng) < DEDUPE_EPSILON
      )
    ) {
      continue;
    }
    out.push({ lat: p.lat, lng: p.lng });
  }
  return out;
}

/**
 * Push a convex ring outward by `bufferM`, returning a polygon.
 *
 * Handles the three shapes a hull can be:
 *
 * - **One point** → a `CIRCLE_SEGMENTS`-gon of radius `bufferM` around it. A single visible stop
 *   still has a neighbourhood, and it is the only thing this can mean.
 * - **Two points** → the segment offset to both sides, which is a rectangle with the ends pushed
 *   out too, so a two-stop day gets a corridor rather than a hairline.
 * - **Three or more** → a miter offset: each vertex moves along the outward bisector of its two
 *   edges by `bufferM / cos(θ/2)`, which is the distance that puts *both* adjacent edges exactly
 *   `bufferM` out. Capped by `MITER_LIMIT` so a near-collinear corner cannot spike.
 *
 * The result always contains the input, which is the property the caller depends on: a stop the
 * traveler can see must never fall outside the area searched around it.
 */
export function bufferShape(ring: LatLng[], bufferM: number = DEFAULT_BUFFER_M): LatLng[] {
  if (ring.length === 0) return [];
  const lat0 = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const mLng = mPerDegLng(lat0);
  // Guard the poles, where a degree of longitude is no distance at all and the division below
  // would produce infinities.
  if (!(mLng > 1)) return ring;

  const dLat = bufferM / M_PER_DEG_LAT;
  const dLng = bufferM / mLng;

  if (ring.length === 1) {
    const [c] = ring;
    return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      return { lat: c.lat + dLat * Math.sin(a), lng: c.lng + dLng * Math.cos(a) };
    });
  }

  if (ring.length === 2) {
    // Work in metres so the offset is a true perpendicular rather than one skewed by the aspect
    // ratio of a degree.
    const [a, b] = ring;
    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * mLng;
    const by = (b.lat - a.lat) * M_PER_DEG_LAT;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    // Perpendicular, and the along-axis extension past each end.
    const px = -uy * bufferM;
    const py = ux * bufferM;
    const ex = ux * bufferM;
    const ey = uy * bufferM;
    const corners = [
      [ax - ex + px, ay - ey + py],
      [bx + ex + px, by + ey + py],
      [bx + ex - px, by + ey - py],
      [ax - ex - px, ay - ey - py],
    ];
    return corners.map(([x, y]) => ({ lat: a.lat + y / M_PER_DEG_LAT, lng: a.lng + x / mLng }));
  }

  const n = ring.length;
  return ring.map((curr, i) => {
    const prev = ring[(i - 1 + n) % n];
    const next = ring[(i + 1) % n];
    // Both edge directions as unit vectors in metres.
    const inX = (curr.lng - prev.lng) * mLng;
    const inY = (curr.lat - prev.lat) * M_PER_DEG_LAT;
    const outX = (next.lng - curr.lng) * mLng;
    const outY = (next.lat - curr.lat) * M_PER_DEG_LAT;
    const inLen = Math.hypot(inX, inY) || 1;
    const outLen = Math.hypot(outX, outY) || 1;
    // Outward normals. The hull is counter-clockwise, so the outward side of a direction (dx, dy)
    // is (dy, -dx).
    const n1x = inY / inLen;
    const n1y = -inX / inLen;
    const n2x = outY / outLen;
    const n2y = -outX / outLen;
    // The bisector, and how far along it to travel. For unit normals separated by the corner's
    // turn angle θ, `|n1+n2|` is `2·cos(θ/2)`, and the miter length that puts *both* adjacent
    // edges exactly `bufferM` out is `bufferM / cos(θ/2)` — which is `2·bufferM / |n1+n2|`. On a
    // square corner (θ = 90°) that is `bufferM·√2`, the diagonal, which is the check in the tests.
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bLenSq = bx * bx + by * by;
    let scale: number;
    if (bLenSq < 1e-12) {
      // A 180° reversal — cannot happen on a real convex hull, but a degenerate input must not
      // produce NaN. Fall back to one of the two normals.
      bx = n1x;
      by = n1y;
      scale = bufferM;
    } else {
      const bLen = Math.sqrt(bLenSq);
      scale = Math.min((2 * bufferM) / bLen, bufferM * MITER_LIMIT);
      bx /= bLen;
      by /= bLen;
    }
    return {
      lat: curr.lat + (by * scale) / M_PER_DEG_LAT,
      lng: curr.lng + (bx * scale) / mLng,
    };
  });
}

/**
 * The whole pipeline: visible footprint plus the points inside it, to a polygon to search.
 *
 * `viewport` is the ground quadrilateral the camera can see, from the renderer. `points` is every
 * candidate — the caller passes the trip's stops and this keeps the ones actually on screen, which
 * is what "the points within the visible area" means.
 *
 * **Falls back to the viewport itself** when the visible area contains fewer points than make a
 * shape. That is not a degraded answer, it is the correct one: with no stops in view there is no
 * cluster to search around, and what the traveler is looking at is the only statement of intent
 * available. The viewport is deliberately *not* buffered in that case — it already describes
 * exactly what is on screen, and pushing past it would search ground the traveler cannot see.
 */
export function searchAreaFor(
  viewport: LatLng[],
  points: LatLng[],
  bufferM: number = DEFAULT_BUFFER_M
): LatLng[] {
  const visible = points.filter((p) => pointInPolygon(p, viewport));
  const hull = convexHull(visible);
  if (hull.length === 0) return dedupe(viewport);
  return bufferShape(hull, bufferM);
}

/**
 * Ray casting, counting crossings of a horizontal ray to the east.
 *
 * Used twice and for two different jobs: keeping only the stops inside the viewport, and filtering
 * a provider's answers down to the area actually asked for — which matters because Google takes a
 * circle rather than a polygon, so its results have to be trimmed to the shape on this side.
 *
 * A point exactly on an edge is unspecified, which is fine for both callers: the buffer means
 * nothing real ever lands there, and being off by one venue on a boundary is not a wrong answer.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;
    if (yi > point.lat !== yj > point.lat) {
      const x = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lng < x) inside = !inside;
    }
  }
  return inside;
}

/** Centre and radius of a circle containing the whole polygon — what a provider that cannot take
 *  a shape (Google) has to be given instead. Not the *minimal* enclosing circle: the centroid plus
 *  the furthest vertex is within a few percent of it for the near-round hulls this produces, and
 *  over-asking is the safe direction when the results are filtered back to the polygon anyway. */
export function enclosingCircle(polygon: LatLng[]): { lat: number; lng: number; radiusM: number } {
  if (polygon.length === 0) return { lat: 0, lng: 0, radiusM: 0 };
  const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
  const mLng = mPerDegLng(lat);
  const radiusM = polygon.reduce((max, p) => {
    const dx = (p.lng - lng) * mLng;
    const dy = (p.lat - lat) * M_PER_DEG_LAT;
    return Math.max(max, Math.hypot(dx, dy));
  }, 0);
  return { lat, lng, radiusM };
}

/** `lat,lng;lat,lng;…` — the compact wire form for the query string. Six decimals is ~11cm, far
 *  finer than anything this shape means, and keeps a 20-vertex polygon well inside a sane URL. */
export function encodePolygon(polygon: LatLng[]): string {
  return polygon.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(";");
}

/** The inverse, rejecting anything malformed. Returns `null` rather than a partial polygon — this
 *  parses a public query string, and half a shape is a query nobody asked for. */
export function decodePolygon(raw: string | null | undefined): LatLng[] | null {
  if (!raw) return null;
  const out: LatLng[] = [];
  for (const pair of raw.split(";")) {
    const [latRaw, lngRaw] = pair.split(",");
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    out.push({ lat, lng });
  }
  return out.length >= 3 ? out : null;
}
