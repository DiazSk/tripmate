/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/pathFollow.test.mjs
 *
 * The uniform-speed test below is the reason this file exists. An OSRM route is dense through a
 * roundabout and sparse along a straight, so a driver that stepped vertex-by-vertex would crawl
 * through junctions and jump down boulevards. On a fast machine that reads as the camera
 * stuttering, which is indistinguishable from a dropped frame, a slow tile load, or the route
 * simply being interesting there — so nobody watching can tell it is a bug.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { HEADING_LOOKAHEAD_M, measurePath, sampleAt, travelEase } from "./pathFollow.ts";

/** Metres per degree of latitude, near enough for building test paths. */
const M_PER_DEG = 111_320;
const north = (metres) => ({ lat: 48.86 + metres / M_PER_DEG, lng: 2.34 });

test("cumM is monotonic and totalM is the sum of the segments", () => {
  const path = measurePath([north(0), north(100), north(250)]);
  assert.equal(path.cumM[0], 0);
  assert.ok(path.cumM[1] > 0 && path.cumM[2] > path.cumM[1]);
  assert.ok(Math.abs(path.totalM - 250) < 1, `expected ~250m, got ${path.totalM}`);
});

test("the ends clamp rather than running off", () => {
  const path = measurePath([north(0), north(100)]);
  const start = sampleAt(path, -50);
  const end = sampleAt(path, 9999);
  assert.ok(Math.abs(start.lat - north(0).lat) < 1e-9, "before the start is the start");
  assert.ok(Math.abs(end.lat - north(100).lat) < 1e-9, "past the end is the end");
});

test("speed is uniform even when the vertices are not", () => {
  // One 10m segment then one 1000m segment — the shape of a route leaving a junction onto a
  // boulevard. Stepping by vertex would spend half the flight on the first 1% of the ground.
  const path = measurePath([north(0), north(10), north(1010)]);
  const steps = 10;
  const samples = Array.from({ length: steps + 1 }, (_, i) =>
    sampleAt(path, (path.totalM * i) / steps)
  );
  const gaps = samples.slice(1).map((s, i) => (s.lat - samples[i].lat) * M_PER_DEG);
  const first = gaps[0];
  for (const gap of gaps) {
    assert.ok(
      Math.abs(gap - first) < 1,
      `every equal-distance step must cover equal ground; got ${gaps.map((g) => g.toFixed(1)).join(", ")}`
    );
  }
});

test("the monotonic cursor gives the same answers as no cursor", () => {
  const path = measurePath([north(0), north(10), north(1010), north(1200)]);
  const cursor = { i: 0 };
  for (let d = 0; d <= path.totalM; d += 37) {
    const withHint = sampleAt(path, d, cursor);
    const without = sampleAt(path, d);
    assert.deepEqual(withHint, without, `cursor diverged at ${d}m`);
  }
});

test("a stale cursor pointing past the target still lands correctly", () => {
  // A replayed beat restarts at 0 with the previous run's cursor still at the end.
  const path = measurePath([north(0), north(500), north(1000)]);
  const stale = { i: 1 };
  assert.deepEqual(sampleAt(path, 0, stale), sampleAt(path, 0));
});

test("heading runs forward along a straight", () => {
  const path = measurePath([north(0), north(500)]);
  const { headingRad } = sampleAt(path, 100);
  assert.ok(Math.abs(headingRad) < 0.01, `due north is 0 rad, got ${headingRad}`);
});

test("a right-angle corner is rounded, not snapped", () => {
  // North for 200m, then east. Approaching the corner, the lookahead must already be turning:
  // strictly between due north (0) and due east (pi/2). A per-vertex bearing would read exactly
  // 0 until the corner and exactly pi/2 after it, and the camera would snap 90 degrees in a frame.
  const corner = { lat: 48.86 + 200 / M_PER_DEG, lng: 2.34 };
  const path = measurePath([
    { lat: 48.86, lng: 2.34 },
    corner,
    { lat: corner.lat, lng: 2.34 + 200 / (M_PER_DEG * Math.cos((48.86 * Math.PI) / 180)) },
  ]);
  const approaching = sampleAt(path, 200 - HEADING_LOOKAHEAD_M / 2).headingRad;
  assert.ok(
    approaching > 0.05 && approaching < Math.PI / 2 - 0.05,
    `expected a heading part-way round the corner, got ${approaching}`
  );
});

test("degenerate paths produce finite numbers rather than looping or dividing by zero", () => {
  const single = measurePath([north(0)]);
  assert.equal(single.totalM, 0);
  const s1 = sampleAt(single, 50);
  assert.ok(Number.isFinite(s1.lat) && Number.isFinite(s1.headingRad));

  const coincident = measurePath([north(0), north(0), north(0)]);
  assert.equal(coincident.totalM, 0);
  const s2 = sampleAt(coincident, 10);
  assert.ok(Number.isFinite(s2.lat) && Number.isFinite(s2.headingRad));

  const empty = measurePath([]);
  assert.equal(empty.totalM, 0);
  assert.ok(Number.isFinite(sampleAt(empty, 5).lat));
});

/* --- travelEase ---
 *
 * The check that matters is continuity, and it is the one eyeballing a piecewise curve does not
 * give you. The first version of this eased the ends and left the middle linear across three
 * branches that did not meet — it stepped 7.6% of the path in a single frame at each join, twice
 * per walk, which on a 900m leg is a 68m teleport and reads as the camera stuttering.
 */

test("the ease starts at 0, ends at 1, and never goes backwards", () => {
  assert.equal(travelEase(0), 0);
  assert.equal(travelEase(1), 1);
  assert.equal(travelEase(-0.5), 0, "before the start");
  assert.equal(travelEase(1.5), 1, "past the end");

  let previous = 0;
  for (let t = 0; t <= 1.0001; t += 0.001) {
    const now = travelEase(t);
    assert.ok(now >= previous - 1e-12, `went backwards at t=${t.toFixed(3)}`);
    previous = now;
  }
});

test("no frame moves more than a smooth profile would — the join test", () => {
  // 1000 steps over the whole walk. A continuous profile's largest step is the peak speed times
  // the step; a broken join shows up as a step many times that, wherever it is.
  const STEPS = 1000;
  let worst = 0;
  let worstAt = 0;
  let previous = travelEase(0);
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const now = travelEase(t);
    const step = now - previous;
    if (step > worst) {
      worst = step;
      worstAt = t;
    }
    previous = now;
  }
  // Peak speed is 1/(1-0.18) ≈ 1.22, so the largest honest step is ≈ 1.22/1000.
  assert.ok(
    worst < 2 / STEPS,
    `largest step was ${(worst * 100).toFixed(2)}% of the path at t=${worstAt.toFixed(3)} — a join does not meet`
  );
});

test("the middle runs at a constant speed", () => {
  // Three equal slices of the plateau must cover equal ground; that is what makes it a walk
  // rather than a permanent accelerate-then-brake.
  const a = travelEase(0.45) - travelEase(0.40);
  const b = travelEase(0.55) - travelEase(0.50);
  assert.ok(Math.abs(a - b) < 1e-9, `plateau is not flat: ${a} vs ${b}`);
});

test("the ends are genuinely slower than the middle", () => {
  const start = travelEase(0.02) - travelEase(0.01);
  const middle = travelEase(0.51) - travelEase(0.50);
  const end = travelEase(0.99) - travelEase(0.98);
  assert.ok(start < middle / 2, "it should ease in, not launch");
  assert.ok(end < middle / 2, "and brake, not stop dead");
});
