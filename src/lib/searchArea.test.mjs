import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUFFER_M,
  bufferShape,
  convexHull,
  decodePolygon,
  encodePolygon,
  enclosingCircle,
  pointInPolygon,
  searchAreaFor,
} from "./searchArea.ts";

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Rome. Offsets from here keep the numbers legible: 0.01° lat is ~1.11km. */
const LAT = 41.9;
const LNG = 12.5;
const at = (dLat, dLng) => ({ lat: LAT + dLat, lng: LNG + dLng });

/** Metres between two coordinates, by the same flat approximation the module uses. */
function metresBetween(a, b) {
  const dx = (b.lng - a.lng) * mPerDegLng((a.lat + b.lat) / 2);
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** A generous box around Rome, as the "what the camera can see" quadrilateral. */
const VIEWPORT = [at(-0.05, -0.05), at(-0.05, 0.05), at(0.05, 0.05), at(0.05, -0.05)];

/** Signed area × 2, counter-clockwise positive. Also the emptiness test for a ring. */
function shoelace(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].lng - ring[i].lng) * (ring[j].lat + ring[i].lat);
  }
  return sum;
}

// --- convexHull ----------------------------------------------------------------------------------

test("fewer than three points come back as-is", () => {
  assert.deepEqual(convexHull([]), []);
  assert.equal(convexHull([at(0, 0)]).length, 1);
  assert.equal(convexHull([at(0, 0), at(0.01, 0.01)]).length, 2);
});

test("duplicate coordinates collapse before the hull is built", () => {
  const hull = convexHull([at(0, 0), at(0, 0), at(0, 0)]);
  assert.equal(hull.length, 1, "three copies of one place is one point, not a triangle");
});

test("a square's hull is its four corners", () => {
  const square = [at(0, 0), at(0, 0.01), at(0.01, 0.01), at(0.01, 0)];
  assert.equal(convexHull(square).length, 4);
});

test("interior points are dropped", () => {
  const square = [at(0, 0), at(0, 0.01), at(0.01, 0.01), at(0.01, 0)];
  const hull = convexHull([...square, at(0.005, 0.005), at(0.004, 0.006)]);
  assert.equal(hull.length, 4);
});

test("collinear points are dropped — they are vertices that carry no shape", () => {
  // Five points along the bottom edge of a triangle.
  const hull = convexHull([
    at(0, 0),
    at(0, 0.0025),
    at(0, 0.005),
    at(0, 0.0075),
    at(0, 0.01),
    at(0.01, 0.005),
  ]);
  assert.equal(hull.length, 3, `expected a triangle, got ${hull.length} vertices`);
});

test("the hull contains every input point", () => {
  const pts = [at(0, 0), at(0.01, 0.002), at(0.004, 0.01), at(-0.006, 0.005), at(0.002, -0.008)];
  const hull = convexHull(pts);
  for (const p of pts) {
    assert.ok(
      pointInPolygon(p, hull) || hull.some((h) => metresBetween(h, p) < 1),
      `${JSON.stringify(p)} fell outside its own hull`
    );
  }
});

test("the hull winds counter-clockwise, which the miter offset depends on", () => {
  const hull = convexHull([at(0, 0), at(0, 0.01), at(0.01, 0.01), at(0.01, 0)]);
  assert.ok(shoelace(hull) > 0, "a clockwise ring would offset inward and shrink the search");
});

// --- bufferShape ---------------------------------------------------------------------------------

test("a single point becomes a ring of the buffer radius around it", () => {
  const centre = at(0, 0);
  const ring = bufferShape([centre], 1000);
  assert.ok(ring.length >= 8, "a point has to become a real area");
  for (const v of ring) {
    assert.ok(Math.abs(metresBetween(centre, v) - 1000) < 5, `vertex at ${metresBetween(centre, v)}m`);
  }
  assert.ok(pointInPolygon(centre, ring));
});

test("two points become a corridor that contains both, ends included", () => {
  const a = at(0, 0);
  const b = at(0, 0.02);
  const ring = bufferShape([a, b], 800);
  assert.equal(ring.length, 4);
  assert.ok(pointInPolygon(a, ring), "the first endpoint must be inside");
  assert.ok(pointInPolygon(b, ring), "the second endpoint must be inside");
  // Pushed past each end, not stopping on them.
  const beyond = { lat: b.lat, lng: b.lng + 500 / mPerDegLng(b.lat) };
  assert.ok(pointInPolygon(beyond, ring), "the corridor must extend past the endpoints");
});

test("a polygon's every edge moves outward by the buffer", () => {
  const hull = convexHull([at(0, 0), at(0, 0.01), at(0.01, 0.01), at(0.01, 0)]);
  const buffered = bufferShape(hull, 1000);
  assert.equal(buffered.length, hull.length, "the offset must not add or drop vertices");
  // Every original vertex ends up strictly inside, and the area strictly grows.
  for (const v of hull) assert.ok(pointInPolygon(v, buffered), "an original vertex escaped");
  assert.ok(Math.abs(shoelace(buffered)) > Math.abs(shoelace(hull)));
});

test("a square's corners move out by buffer·√2, which is what a true miter does", () => {
  const hull = convexHull([at(0, 0), at(0, 0.01), at(0.01, 0.01), at(0.01, 0)]);
  const buffered = bufferShape(hull, 1000);
  for (let i = 0; i < hull.length; i++) {
    const moved = metresBetween(hull[i], buffered[i]);
    assert.ok(
      Math.abs(moved - 1000 * Math.SQRT2) < 20,
      `corner moved ${moved.toFixed(0)}m, expected ~${(1000 * Math.SQRT2).toFixed(0)}m`
    );
  }
});

test("a needle-sharp corner is truncated rather than spiking to infinity", () => {
  // Two nearly-collinear edges: an unlimited miter here runs to thousands of kilometres.
  const sliver = [at(0, 0), at(0.00002, 0.02), at(-0.00002, 0.02)];
  const buffered = bufferShape(sliver, 1000);
  for (const v of buffered) {
    for (const s of sliver) {
      assert.ok(
        metresBetween(s, v) < 1000 * 4,
        `miter spiked to ${metresBetween(s, v).toFixed(0)}m — the limit is not holding`
      );
    }
  }
});

test("an empty ring buffers to nothing", () => {
  assert.deepEqual(bufferShape([], 1000), []);
});

// --- searchAreaFor -------------------------------------------------------------------------------

test("points outside the visible area take no part in the shape", () => {
  const inView = [at(0, 0), at(0.005, 0.005), at(-0.005, 0.004)];
  const offScreen = [at(3, 3), at(-2, -2)];
  const area = searchAreaFor(VIEWPORT, [...inView, ...offScreen], 500);
  for (const p of offScreen) {
    assert.ok(!pointInPolygon(p, area), "an off-screen stop dragged the search area to it");
  }
  for (const p of inView) assert.ok(pointInPolygon(p, area));
});

test("no visible points falls back to the viewport itself, unbuffered", () => {
  const area = searchAreaFor(VIEWPORT, [at(5, 5)], DEFAULT_BUFFER_M);
  assert.equal(area.length, VIEWPORT.length);
  // Unbuffered: the corners are exactly the viewport's, not pushed out.
  for (let i = 0; i < VIEWPORT.length; i++) {
    assert.ok(metresBetween(VIEWPORT[i], area[i]) < 1);
  }
});

test("no points at all still yields a searchable area", () => {
  const area = searchAreaFor(VIEWPORT, [], DEFAULT_BUFFER_M);
  assert.ok(area.length >= 3);
  assert.ok(pointInPolygon(at(0, 0), area));
});

test("one visible point yields a buffered neighbourhood, not a degenerate ring", () => {
  const area = searchAreaFor(VIEWPORT, [at(0, 0)], 1000);
  assert.ok(area.length >= 8);
  assert.ok(pointInPolygon(at(0, 0), area));
  assert.ok(pointInPolygon(at(0.005, 0), area), "500m away should be inside a 1km buffer");
  assert.ok(!pointInPolygon(at(0.02, 0), area), "2.2km away should not be");
});

test("the buffer is measured in kilometres, and a bigger one searches more ground", () => {
  const pts = [at(0, 0), at(0.004, 0.004), at(-0.004, 0.003)];
  const small = searchAreaFor(VIEWPORT, pts, 300);
  const large = searchAreaFor(VIEWPORT, pts, 2000);
  assert.ok(Math.abs(shoelace(large)) > Math.abs(shoelace(small)) * 2);
});

// --- enclosingCircle -----------------------------------------------------------------------------

test("the circle contains every vertex of the polygon", () => {
  const poly = bufferShape(convexHull([at(0, 0), at(0.01, 0.004), at(0.003, 0.012)]), 800);
  const circle = enclosingCircle(poly);
  for (const v of poly) {
    assert.ok(
      metresBetween(circle, v) <= circle.radiusM + 1,
      `vertex ${metresBetween(circle, v).toFixed(0)}m out of a ${circle.radiusM.toFixed(0)}m circle`
    );
  }
});

test("an empty polygon has no circle rather than a NaN one", () => {
  const c = enclosingCircle([]);
  assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng) && Number.isFinite(c.radiusM));
  assert.equal(c.radiusM, 0);
});

// --- the wire form -------------------------------------------------------------------------------

test("a polygon survives a round trip through the query string", () => {
  const poly = bufferShape(convexHull([at(0, 0), at(0.01, 0.004), at(0.003, 0.012)]), 800);
  const back = decodePolygon(encodePolygon(poly));
  assert.ok(back);
  assert.equal(back.length, poly.length);
  for (let i = 0; i < poly.length; i++) {
    assert.ok(metresBetween(poly[i], back[i]) < 0.5, "six decimals must be lossless enough");
  }
});

test("malformed input is rejected whole, never as a partial shape", () => {
  assert.equal(decodePolygon(null), null);
  assert.equal(decodePolygon(""), null);
  assert.equal(decodePolygon("41.9,12.5"), null, "two vertices is not a polygon");
  assert.equal(decodePolygon("41.9,12.5;41.8,12.4;oops,12.3"), null);
  assert.equal(decodePolygon("41.9,12.5;41.8,12.4;91,12.3"), null, "latitude out of range");
  assert.equal(decodePolygon("41.9,12.5;41.8,12.4;41.7,181"), null, "longitude out of range");
});

test("a well-formed triangle decodes", () => {
  const poly = decodePolygon("41.9,12.5;41.8,12.4;41.7,12.6");
  assert.equal(poly.length, 3);
  assert.equal(poly[0].lat, 41.9);
});

// --- pointInPolygon ------------------------------------------------------------------------------

test("inside, outside, and a shape too small to be one", () => {
  const square = [at(0, 0), at(0, 0.01), at(0.01, 0.01), at(0.01, 0)];
  assert.ok(pointInPolygon(at(0.005, 0.005), square));
  assert.ok(!pointInPolygon(at(0.02, 0.005), square));
  assert.ok(!pointInPolygon(at(0.005, 0.005), [at(0, 0), at(0, 0.01)]), "a segment contains nothing");
});

test("a concave polygon's notch is genuinely outside", () => {
  // An L, which the buffer never produces but the filter is a general routine.
  const ell = [at(0, 0), at(0, 0.02), at(0.01, 0.02), at(0.01, 0.01), at(0.02, 0.01), at(0.02, 0)];
  assert.ok(pointInPolygon(at(0.005, 0.005), ell));
  assert.ok(!pointInPolygon(at(0.015, 0.015), ell), "the notch must not read as inside");
});
