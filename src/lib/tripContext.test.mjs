/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/tripContext.test.mjs
 *
 * `travelSection` is what tells the planning model where its travel numbers came from, and both
 * ways of getting it wrong are silent. Telling the model every leg is a straight-line estimate
 * throws away accuracy the pipeline paid OSRM for; telling it every leg is measured when most are
 * not is the dishonesty `osrmRoute.ts` was written to avoid inheriting. Since `applyRealRoutes`
 * landed, the mixed case is the *common* one — with the default modes anything past 1.5km goes to
 * transit and nothing routes transit — so the three-way branch is load-bearing, not defensive.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { travelSection } from "./tripContext.ts";

const leg = (from, to, minutes, estimated) => ({
  from,
  to,
  mode: "walk",
  distanceKm: 1.2,
  minutes,
  estimated,
});

const section = (legs) => travelSection({ pois: [], travelLegs: legs, notes: [] });

test("an all-estimated set is still described as estimated", () => {
  const out = section([leg("A", "B", 14, true), leg("B", "C", 9, true)]);
  assert.match(out, /straight-line distance with a road-circuity correction/);
  assert.doesNotMatch(out, /real road-network/);
});

test("an all-measured set drops the estimate disclaimer and the per-leg marker", () => {
  const out = section([leg("A", "B", 14, false), leg("B", "C", 9, false)]);
  assert.match(out, /\(real road-network routes\)/);
  assert.doesNotMatch(out, /straight-line/, "telling the model a measured number is a guess wastes the lookup");
  assert.doesNotMatch(out, /\(est\)/);
});

test("a mixed set says so and marks which legs are which", () => {
  const out = section([leg("A", "B", 14, false), leg("B", "C", 9, true)]);
  assert.match(out, /except those marked \(est\)/);
  assert.match(out, /- A -> B: 14 min walk \(1\.2 km\)/, "a measured leg carries no marker");
  assert.match(out, /- B -> C: 9 min walk \(est\) \(1\.2 km\)/, "an estimated one does");
});

test("(est) reuses the marker poiLine already uses for an estimated duration", () => {
  // One piece of vocabulary for "this number is a guess", not two for the model to learn.
  assert.match(section([leg("A", "B", 9, true)]), /\(est\)/);
});

test("no legs is still a sentence rather than an empty section", () => {
  assert.match(section([]), /No travel times/);
});
