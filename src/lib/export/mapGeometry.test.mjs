/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/mapGeometry.test.mjs
 *
 * Simplification and path serialization are the two things standing between an OSM road network
 * and a file small enough to email. Both are easy to get subtly wrong in ways that only show up
 * as a corrupt `d` attribute in a browser — which nothing in this suite can see. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  clipRuns,
  joinWithinBudget,
  lengthOf,
  pathOf,
  projectSegment,
  segmentPaths,
  simplify,
} from "./mapGeometry.ts";
import { fitFrame } from "./mapProjection.ts";

const pt = (x, y) => ({ x, y });

test("a collinear run collapses to its endpoints", () => {
  const line = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(4, 0)];
  assert.deepEqual(simplify(line, 0.5), [pt(0, 0), pt(4, 0)]);
});

test("a deviation larger than the tolerance is kept", () => {
  const line = [pt(0, 0), pt(2, 5), pt(4, 0)];
  assert.equal(simplify(line, 0.5).length, 3);
});

test("a deviation smaller than the tolerance is dropped", () => {
  const line = [pt(0, 0), pt(2, 0.1), pt(4, 0)];
  assert.deepEqual(simplify(line, 0.5), [pt(0, 0), pt(4, 0)]);
});

test("endpoints always survive", () => {
  const line = [pt(0, 0), pt(1, 0.01), pt(2, 0.02), pt(3, 0)];
  const out = simplify(line, 100);
  assert.deepEqual(out[0], pt(0, 0));
  assert.deepEqual(out[out.length - 1], pt(3, 0));
});

test("simplification is monotonic in tolerance", () => {
  const zig = Array.from({ length: 60 }, (_, i) => pt(i, (i % 2) * 0.8));
  const tight = simplify(zig, 0.05).length;
  const loose = simplify(zig, 2).length;
  assert.ok(loose <= tight, `a looser tolerance must not keep more points (${loose} vs ${tight})`);
  assert.ok(loose < zig.length, "a loose tolerance must actually remove something");
});

test("segments too short to simplify are returned untouched", () => {
  assert.deepEqual(simplify([], 1), []);
  assert.deepEqual(simplify([pt(1, 2)], 1), [pt(1, 2)]);
  assert.deepEqual(simplify([pt(1, 2), pt(3, 4)], 1), [pt(1, 2), pt(3, 4)]);
});

test("a closed ring keeps its shape rather than collapsing to a point", () => {
  // Both endpoints of a ring are the same coordinate; a naive implementation measures every
  // interior point against a zero-length baseline and throws the whole ring away.
  const ring = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10), pt(0, 0)];
  assert.ok(simplify(ring, 0.5).length >= 4, "a lake must not vanish");
});

test("a path is one moveto followed by linetos", () => {
  assert.equal(pathOf([pt(0, 0), pt(10, 20), pt(30, 40)]), "M0 0L10 20L30 40");
});

test("coordinates are rounded to a tenth of a unit", () => {
  assert.equal(pathOf([pt(1.234, 5.678), pt(9.87, 6.54)]), "M1.2 5.7L9.9 6.5");
});

test("points that round onto each other are not emitted twice", () => {
  const d = pathOf([pt(0, 0), pt(0.01, 0.01), pt(0.02, 0.0), pt(10, 10)]);
  assert.equal(d, "M0 0L10 10");
});

test("a segment with nothing left to draw produces no path at all", () => {
  assert.equal(pathOf([]), "", "empty");
  assert.equal(pathOf([pt(5, 5)]), "", "a single node is not a line");
  assert.equal(pathOf([pt(5, 5), pt(5.01, 5.01)]), "", "a sub-rounding stub is not a line");
});

test("negative coordinates stay parseable", () => {
  // `L-5 -3` is valid SVG: the minus separates the numbers. A stray missing space would not be.
  const d = pathOf([pt(-5.04, -3.02), pt(4, 2)]);
  assert.equal(d, "M-5 -3L4 2");
  assert.doesNotMatch(d, /\d-/, "a digit must never run straight into a minus sign");
});

test("unusable coordinates are skipped when projecting, not projected as zero", () => {
  const frame = fitFrame({ minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.8 });
  const projected = projectSegment(
    [{ lat: 35.02, lng: 135.72 }, null, { lat: 0, lng: 0 }, {}, { lat: 35.04, lng: 135.74 }],
    frame,
  );
  assert.equal(projected.length, 2, "only the two real coordinates survive");
  for (const p of projected) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("length is the sum of the drawn edges", () => {
  assert.equal(lengthOf([pt(0, 0), pt(3, 4)]), 5);
  assert.equal(lengthOf([pt(0, 0), pt(3, 4), pt(3, 4)]), 5);
  assert.equal(lengthOf([pt(9, 9)]), 0);
});

test("segment paths come back longest first", () => {
  const frame = fitFrame({ minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.8 });
  const short = [{ lat: 35.02, lng: 135.72 }, { lat: 35.021, lng: 135.721 }];
  const long = [{ lat: 35.0, lng: 135.7 }, { lat: 35.09, lng: 135.79 }];
  const paths = segmentPaths([short, long], frame, 0.4);
  assert.equal(paths.length, 2);
  assert.ok(paths[0].lengthUnits > paths[1].lengthUnits, "the arterial must be offered first");
});

test("segments that survive nothing are absent from the result", () => {
  const frame = fitFrame({ minLat: 35.0, maxLat: 35.1, minLng: 135.7, maxLng: 135.8 });
  const paths = segmentPaths([[], [{ lat: 35.02, lng: 135.72 }], [null, {}]], frame, 0.4);
  assert.deepEqual(paths, []);
});

test("the budget takes whole paths and stops, never a fragment", () => {
  const paths = [
    { d: "M0 0L100 100", lengthUnits: 141 },
    { d: "M0 0L50 50", lengthUnits: 70 },
    { d: "M0 0L10 10", lengthUnits: 14 },
  ];
  // "M0 0L100 100" is 12 chars; the next is 10, so a 15-char budget admits exactly one.
  assert.equal(joinWithinBudget(paths, 15), "M0 0L100 100", "the second path would have overflowed");
  assert.equal(joinWithinBudget(paths, 25), "M0 0L100 100M0 0L50 50", "two fit, the third does not");
  assert.equal(joinWithinBudget(paths, 0), "", "a zero budget draws nothing, not half a path");
  assert.equal(joinWithinBudget(paths, 9999), paths.map((p) => p.d).join(""));
});

test("a way that only clips the corner of the frame keeps just that corner", () => {
  // Overpass hands back whole ways, so a motorway crossing the frame arrives with its full
  // hundred-kilometre geometry attached. Serializing all of it is the cost this avoids.
  const long = [pt(-5000, 340), pt(-2000, 340), pt(500, 340), pt(3000, 340), pt(9000, 340)];
  const runs = clipRuns(long, 1000, 680, 150);
  assert.equal(runs.length, 1);
  assert.ok(runs[0].length < long.length, "the far-off nodes are dropped");
  assert.ok(runs[0][0].x < 0, "one node outside is kept so the road reaches the edge");
  assert.ok(runs[0][runs[0].length - 1].x > 1000, "and one on the way out");
});

test("a road that leaves the frame and comes back is two runs, not one line across it", () => {
  const there = [pt(100, 100), pt(200, 100), pt(5000, 100), pt(200, 600), pt(100, 600)];
  const runs = clipRuns(there, 1000, 680, 150);
  assert.equal(runs.length, 2, "the excursion must break the polyline");
});

test("a polyline entirely outside the frame yields nothing", () => {
  assert.deepEqual(clipRuns([pt(-9000, -9000), pt(-8000, -8000)], 1000, 680, 150), []);
});

test("a polyline entirely inside the frame is passed through whole", () => {
  const inside = [pt(10, 10), pt(500, 300), pt(900, 600)];
  assert.deepEqual(clipRuns(inside, 1000, 680, 150), [inside]);
});
