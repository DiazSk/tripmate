/* Run: node --test src/lib/routeMatrix.test.mjs
 *
 * OSRM's Table endpoint returns dense `durations`/`distances` matrices in seconds/meters — no
 * per-element status field, no protobuf-string parsing needed. An unroutable pair is `null` in
 * both matrices at `[i][j]`, and reading it as `0` would claim two places are adjacent when no
 * route between them was found — a plan that under-books travel strands the traveler mid-day,
 * which is why the existing estimator is deliberately conservative.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  distilRouteMatrix,
  fetchDayTravelMinutes,
  MAX_MATRIX_STOPS,
  probeTransitAvailable,
} from "./routeMatrix.ts";

/** Verified live: `curl "https://router.project-osrm.org/table/v1/driving/2.3522,48.8566;2.3376,48.8606;2.3444,48.8738?annotations=duration,distance"`
 *  against the same 3-point Paris triangle used by the old fixture. `walking`, `foot`, and
 *  `cycling` all returned this exact same payload byte-for-byte — the public demo only hosts the
 *  driving profile — which is why `drive` is the only mode that queries it; `walk` short-circuits
 *  to an empty map instead of getting car speeds mislabeled as walking times. */
const response = {
  code: "Ok",
  durations: [
    [0, 205.9, 439.3],
    [406.3, 0, 350.8],
    [492.1, 527.5, 0],
  ],
  distances: [
    [0, 1140, 2510.2],
    [2287.6, 0, 2021.2],
    [2768.3, 3054.3, 0],
  ],
};

test("reads a dense duration matrix into minutes", () => {
  const legs = distilRouteMatrix(response);
  const leg = legs.find((l) => l.fromIndex === 0 && l.toIndex === 1);
  assert.equal(leg.minutes, 3); // 205.9s
  assert.equal(leg.distanceMeters, 1140);
});

test("drops the self-pairs the matrix always includes", () => {
  const legs = distilRouteMatrix(response);
  assert.equal(legs.some((l) => l.fromIndex === l.toIndex), false);
  assert.equal(legs.length, 6); // 3x3 minus the 3 diagonal self-pairs
});

test("ignores a pair with no route rather than reading it as zero minutes", () => {
  const unroutable = {
    code: "Ok",
    durations: [
      [0, null],
      [406.3, 0],
    ],
    distances: [
      [0, null],
      [2287.6, 0],
    ],
  };
  const legs = distilRouteMatrix(unroutable);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].fromIndex, 1);
  assert.equal(legs[0].toIndex, 0);
});

test("tolerates a rejected or malformed request without throwing", () => {
  assert.deepEqual(distilRouteMatrix(null), []);
  assert.deepEqual(distilRouteMatrix({ code: "InvalidQuery" }), []);
  assert.deepEqual(distilRouteMatrix({ code: "Ok", durations: "nope" }), []);
});

test("falls back to null distance when the distances matrix is missing or short", () => {
  const noDistances = { code: "Ok", durations: [[0, 60], [60, 0]] };
  const legs = distilRouteMatrix(noDistances);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].distanceMeters, null);
});

test("keeps the stop cap sane for a shared public demo server", () => {
  assert.ok(MAX_MATRIX_STOPS > 0 && MAX_MATRIX_STOPS <= 10);
});

test("probeTransitAvailable is unconditionally false — no free transit data source exists", async () => {
  assert.equal(await probeTransitAvailable(), false);
});

test("walk mode resolves an empty map without a network call — no real walking data exists on this server", async () => {
  const points = [
    { lat: 48.8566, lon: 2.3522 },
    { lat: 48.8606, lon: 2.3376 },
  ];
  const legs = await fetchDayTravelMinutes(points, "walk");
  assert.deepEqual(legs, new Map());
});
