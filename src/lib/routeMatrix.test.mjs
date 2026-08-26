/* Run: node --test src/lib/routeMatrix.test.mjs
 *
 * Two cases carry real weight. Durations arrive as protobuf second strings ("1305s"), so a naive
 * Number() yields NaN and every leg silently becomes untimed. And `condition` must be honoured:
 * an unroutable pair still appears in the response, and reading its "0s" as a real duration would
 * claim two places are adjacent when no route between them was found — a plan that under-books
 * travel strands the traveler mid-day, which is why the existing estimator is deliberately
 * conservative. */
import assert from "node:assert/strict";
import test from "node:test";
import { distilRouteMatrix, MAX_MATRIX_STOPS } from "./routeMatrix.ts";

/** Verified live against a 3×3 Paris matrix. */
const response = {
  elements: [
    { condition: "ROUTE_EXISTS", originIndex: 0, destinationIndex: 0, duration: "0s" },
    { condition: "ROUTE_EXISTS", originIndex: 2, destinationIndex: 1, duration: "1305s", distanceMeters: 1597 },
    { condition: "ROUTE_EXISTS", originIndex: 1, destinationIndex: 2, duration: "1294s", distanceMeters: 1583 },
  ],
};

test("parses a protobuf second string into minutes", () => {
  const legs = distilRouteMatrix(response);
  const leg = legs.find((l) => l.fromIndex === 2 && l.toIndex === 1);
  assert.equal(leg.minutes, 22); // 1305s
  assert.equal(leg.distanceMeters, 1597);
});

test("drops the self-pairs the matrix always includes", () => {
  assert.equal(distilRouteMatrix(response).some((l) => l.fromIndex === l.toIndex), false);
  assert.equal(distilRouteMatrix(response).length, 2);
});

test("ignores a pair with no route rather than reading it as zero minutes", () => {
  const unroutable = {
    elements: [{ condition: "ROUTE_NOT_FOUND", originIndex: 0, destinationIndex: 1, duration: "0s" }],
  };
  assert.deepEqual(distilRouteMatrix(unroutable), []);
});

test("skips an element whose duration is not a parseable second string", () => {
  const weird = {
    elements: [
      { condition: "ROUTE_EXISTS", originIndex: 0, destinationIndex: 1, duration: 1305 },
      { condition: "ROUTE_EXISTS", originIndex: 0, destinationIndex: 2, duration: "abc" },
      { condition: "ROUTE_EXISTS", originIndex: 0, destinationIndex: 3, duration: "60s" },
    ],
  };
  const legs = distilRouteMatrix(weird);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].minutes, 1);
});

test("tolerates a rejected request without throwing", () => {
  // A 12x12 really does come back as an HTTP 400 payload rather than elements.
  assert.deepEqual(distilRouteMatrix(null), []);
  assert.deepEqual(distilRouteMatrix({ http_error: "400 Client Error" }), []);
  assert.deepEqual(distilRouteMatrix({ elements: "nope" }), []);
});

test("keeps the cap under Google's hard TRANSIT element limit", () => {
  // origins x destinations must be <= 100 for TRANSIT, and this cap squares.
  assert.ok(MAX_MATRIX_STOPS * MAX_MATRIX_STOPS <= 100);
});

test("the transit margin distinguishes a real network from a walking fallback", () => {
  // Google silently answers a TRANSIT request with the walking route where no transit exists:
  // probed in rural Val d'Orcia both modes returned the identical 3301s, while Paris returned
  // 1599s by transit against 4322s on foot. A probe trusting `condition` alone therefore returns
  // true everywhere. These are the two real observations the threshold has to separate.
  const ratio = (transit, walk) => transit / walk;
  assert.ok(ratio(1599, 4322) <= 0.8, "Paris transit should count as real");
  assert.ok(ratio(3301, 3301) > 0.8, "an identical duration is a walking fallback, not transit");
});
