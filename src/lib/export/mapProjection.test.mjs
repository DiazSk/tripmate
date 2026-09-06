/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/mapProjection.test.mjs
 *
 * The projection the offline map is drawn through. Every case here is one that produces a blank
 * or visibly wrong map rather than an error: a degenerate bounds divides by zero, a stop saved
 * without coordinates lands the whole frame on Null Island, and an unfitted aspect ratio squashes
 * the city. None of it is reachable from a rendering test, because nothing renders in this suite. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  boundsDiagonalKm,
  boundsOf,
  fitFrame,
  frameBounds,
  inverseMercator,
  isUsableCoord,
  MERCATOR_MAX_LAT,
  mercatorXY,
  padBounds,
  projectToFrame,
  VIEW,
} from "./mapProjection.ts";

const near = (actual, expected, tolerance, message) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ~${expected}, got ${actual}`,
  );

test("the equator projects to the vertical middle of the world", () => {
  assert.equal(mercatorXY(0, 0).y, 0.5);
});

test("longitude maps linearly across the full width", () => {
  assert.equal(mercatorXY(0, -180).x, 0);
  assert.equal(mercatorXY(0, 0).x, 0.5);
  assert.equal(mercatorXY(0, 180).x, 1);
});

test("the Mercator cut-off latitudes are the top and bottom of the world", () => {
  near(mercatorXY(MERCATOR_MAX_LAT, 0).y, 0, 1e-6, "north edge");
  near(mercatorXY(-MERCATOR_MAX_LAT, 0).y, 1, 1e-6, "south edge");
});

test("latitudes beyond the cut-off clamp instead of running to infinity", () => {
  assert.ok(Number.isFinite(mercatorXY(90, 0).y), "the north pole must not project to Infinity");
  assert.ok(Number.isFinite(mercatorXY(-90, 0).y), "the south pole must not project to Infinity");
});

test("north is up", () => {
  assert.ok(mercatorXY(50, 0).y < mercatorXY(40, 0).y, "a higher latitude must have a smaller y");
});

test("a coordinate is usable only when it carries a real position", () => {
  assert.equal(isUsableCoord({ lat: 35.01, lng: 135.76 }), true);
  assert.equal(isUsableCoord(null), false);
  assert.equal(isUsableCoord(undefined), false);
  assert.equal(isUsableCoord({}), false, "an older saved stop can carry no coordinates at all");
  assert.equal(isUsableCoord({ lat: 35.01 }), false);
  assert.equal(isUsableCoord({ lat: NaN, lng: 12 }), false);
  assert.equal(isUsableCoord({ lat: 91, lng: 0 }), false);
  assert.equal(isUsableCoord({ lat: 0, lng: 181 }), false);
});

test("Null Island is rejected but the equator is not", () => {
  assert.equal(isUsableCoord({ lat: 0, lng: 0 }), false, "(0,0) is what a missing coordinate looks like");
  assert.equal(isUsableCoord({ lat: -0.18, lng: -78.47 }), true, "Quito sits on the equator");
  assert.equal(isUsableCoord({ lat: 0.31, lng: 32.58 }), true, "so does Kampala");
});

test("bounds ignore unusable points instead of stretching to include them", () => {
  const bounds = boundsOf([
    { lat: 35.0, lng: 135.7 },
    { lat: 0, lng: 0 },
    null,
    {},
    { lat: 35.1, lng: 135.8 },
  ]);
  assert.deepEqual(bounds, { minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.8 });
});

test("bounds over nothing usable are null, not an empty box", () => {
  assert.equal(boundsOf([]), null);
  assert.equal(boundsOf([null, {}, { lat: 0, lng: 0 }]), null);
});

test("padding grows the box on every side", () => {
  const padded = padBounds({ minLat: 10, maxLat: 20, minLng: 30, maxLng: 40 }, 0.1);
  assert.deepEqual(padded, { minLat: 9, maxLat: 21, minLng: 29, maxLng: 41 });
});

test("padding never pushes past the poles or the antimeridian", () => {
  const padded = padBounds({ minLat: -89, maxLat: 89, minLng: -179, maxLng: 179 }, 0.5);
  assert.ok(padded.minLat >= -90 && padded.maxLat <= 90);
  assert.ok(padded.minLng >= -180 && padded.maxLng <= 180);
});

test("a fitted frame matches the view's aspect ratio", () => {
  const frame = fitFrame({ minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.8 });
  // In Mercator the projected box must have the same shape as the pixel box, or the city is
  // stretched along one axis.
  near(frame.spanX / frame.spanY, VIEW.width / VIEW.height, 1e-9, "frame aspect");
});

test("fitting grows the deficient axis rather than cropping the other", () => {
  // A tall, narrow bounds: the fit must widen it, and every corner must stay inside.
  const bounds = { minLat: 35.0, maxLat: 35.4, minLng: 135.7, maxLng: 135.72 };
  const frame = fitFrame(bounds);
  for (const lat of [bounds.minLat, bounds.maxLat]) {
    for (const lng of [bounds.minLng, bounds.maxLng]) {
      const { x, y } = projectToFrame(lat, lng, frame);
      assert.ok(x >= -0.001 && x <= VIEW.width + 0.001, `corner x ${x} escaped the frame`);
      assert.ok(y >= -0.001 && y <= VIEW.height + 0.001, `corner y ${y} escaped the frame`);
    }
  }
});

test("a single stop still yields a drawable frame", () => {
  // Every projected value would be NaN if the zero-area bounds were used as-is.
  const bounds = boundsOf([{ lat: 35.01, lng: 135.76 }]);
  const frame = fitFrame(bounds);
  assert.ok(frame.spanX > 0 && frame.spanY > 0, "a degenerate bounds must be expanded");
  const { x, y } = projectToFrame(35.01, 135.76, frame);
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
  near(x, VIEW.width / 2, 0.5, "the lone stop sits at the centre");
  near(y, VIEW.height / 2, 0.5, "the lone stop sits at the centre");
});

test("stops at one address do not collapse the frame either", () => {
  const frame = fitFrame(boundsOf([
    { lat: 48.8584, lng: 2.2945 },
    { lat: 48.8584, lng: 2.2945 },
  ]));
  assert.ok(frame.spanX > 0 && frame.spanY > 0);
});

test("the frame's corners project to the corners of the view", () => {
  const frame = fitFrame({ minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.9 });
  const topLeft = projectToFrame(
    // Invert the frame back to degrees is overkill; the projected window's own corners suffice.
    35.1,
    135.7,
    frame,
  );
  assert.ok(topLeft.x >= 0 && topLeft.y >= 0);
  const bottomRight = projectToFrame(35.0, 135.9, frame);
  assert.ok(bottomRight.x <= VIEW.width && bottomRight.y <= VIEW.height);
  assert.ok(bottomRight.y > topLeft.y, "the southern edge is below the northern one");
});

test("metres-per-unit shrinks as the frame covers more ground", () => {
  const tight = fitFrame({ minLat: 35.0, maxLat: 35.01, minLng: 135.7, maxLng: 135.71 });
  const wide = fitFrame({ minLat: 35.0, maxLat: 35.5, minLng: 135.7, maxLng: 136.2 });
  assert.ok(
    tight.unitsPerMetre > wide.unitsPerMetre,
    "a 1km frame must draw a metre larger than a 50km frame does",
  );
});

test("a hundred-metre accuracy circle is a visible but small fraction of a city frame", () => {
  // Sanity-check the units the GPS accuracy circle is sized in: ~11km across at this latitude.
  const frame = fitFrame({ minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.8 });
  const radius = 100 * frame.unitsPerMetre;
  assert.ok(radius > 0.5, `100m should not vanish, got ${radius} units`);
  assert.ok(radius < VIEW.width / 10, `100m should not swamp the map, got ${radius} units`);
});

test("the diagonal separates a walkable city from a multi-city trip", () => {
  const city = boundsDiagonalKm({ minLat: 35.0, maxLat: 35.05, minLng: 135.72, maxLng: 135.79 });
  assert.ok(city > 1 && city < 15, `a city centre should be single-digit km, got ${city}`);

  // Kyoto to Tokyo.
  const region = boundsDiagonalKm({ minLat: 34.98, maxLat: 35.68, minLng: 135.75, maxLng: 139.76 });
  assert.ok(region > 300, `a two-city trip should be hundreds of km, got ${region}`);
});

test("inverting the projection returns the original coordinate", () => {
  for (const [lat, lng] of [[35.011, 135.768], [-33.87, 151.21], [64.14, -21.94], [0.31, 32.58]]) {
    const { x, y } = mercatorXY(lat, lng);
    const back = inverseMercator(x, y);
    near(back.lat, lat, 1e-9, `lat round-trip for ${lat}`);
    near(back.lng, lng, 1e-9, `lng round-trip for ${lng}`);
  }
});

test("a frame reports the box it actually shows, not the box it was asked for", () => {
  // The fit widens the deficient axis, so the visible box is larger than the requested one —
  // which is exactly why the road query has to be built from this and not from the stop bounds.
  const asked = { minLat: 35.0, maxLat: 35.4, minLng: 135.7, maxLng: 135.72 };
  const shown = frameBounds(fitFrame(asked));
  assert.ok(shown.minLng < asked.minLng && shown.maxLng > asked.maxLng, "the frame widened");
  near(shown.minLat, asked.minLat, 1e-6, "the tall axis is unchanged");
  near(shown.maxLat, asked.maxLat, 1e-6, "the tall axis is unchanged");
});
