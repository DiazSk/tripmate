/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/scorers/coordinates.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import { scoreCoordinates } from "./coordinates.ts";
import { itineraryToParsed } from "../itineraryToParsed.ts";

// A stop needs only a name, a point and a category to be scored; `itineraryToParsed` tolerates the
// rest being absent, and filling them in would only obscure which field each case is about.
const stop = (name, lat, lng, category = "other") => ({ name, lat, lng, category, cost: 0, note: "" });
const plan = (...days) =>
  itineraryToParsed({
    tier: "midrange",
    days: days.map((stops, i) => ({ date: `2026-09-${12 + i}`, weather: "", stops })),
  });

test("two different venues on one point is the defect", () => {
  // The shape of the real nine-day plan: every breakfast pinned to the Pienza town centre.
  const score = scoreCoordinates(
    plan([
      stop("Breakfast at Caffè Poliziano", 43.0766, 11.6785, "food"),
      stop("Breakfast at Caffè Fiaschetteria", 43.0766, 11.6785, "food"),
    ])
  );
  assert.equal(score.colliding, 2);
  assert.equal(score.normalized, 0);
  assert.deepEqual(score.collisions[0].venues.sort(), [
    "Caffè Fiaschetteria",
    "Caffè Poliziano",
  ]);
});

test("the repaired plan's own clusters are not the defect", () => {
  // Every shared point from the real post-fix run, verbatim. All three Pienza points fall within
  // ~20m of each other, so this is ONE cluster of six stops — which is exactly why each exclusion
  // in `venueOf` had to exist: any one of them missing scores this plan as broken.
  const score = scoreCoordinates(
    plan([
      stop("Hotel check-in and settle", 43.0764, 11.6787),
      stop("Private taxi to Montalcino", 43.0764, 11.6787, "transit"),
      stop("Lunch around Corso il Rossellino", 43.0765, 11.6785, "food"),
      stop("Shopping on Corso il Rossellino", 43.0765, 11.6785),
      stop("Dinner in historic center", 43.0764, 11.6788, "food"),
      stop("Farewell lunch in Pienza", 43.0764, 11.6788, "food"),
      stop("Lunch in Montalcino center", 43.0575, 11.493, "food"),
      stop("Taxi to Montepulciano", 43.0575, 11.493, "transit"),
    ])
  );
  assert.deepEqual(score.collisions, []);
  assert.equal(score.colliding, 0);
  assert.equal(score.maxCluster, 6);
});

test("one venue named two ways keeps one point", () => {
  // Only the first has a lead-in to strip, so they reach `distinctVenues` as different strings.
  const score = scoreCoordinates(
    plan([
      stop("Coffee at Corso il Rossellino", 43.0765, 11.6785, "food"),
      stop("Shopping on Corso il Rossellino", 43.0765, 11.6785),
    ])
  );
  assert.deepEqual(score.collisions, []);
  // The shorter spelling is the one kept, so a report names the place rather than the errand.
  assert.equal(score.named, 2);
});

test("the same venue on two days is not a collision", () => {
  const score = scoreCoordinates(
    plan([stop("Dinner at Latte di Luna", 43.0789, 11.6761, "food")]),
  );
  assert.equal(score.colliding, 0);
  assert.equal(score.normalized, 1);
});

test("fifty metres is the line", () => {
  // Mutation target: `<=` and SAME_POINT_M. 0.0004° of latitude is ~44m, 0.0006° is ~67m.
  const near = scoreCoordinates(
    plan([
      stop("Lunch at Osteria Sette di Vino", 43.0766, 11.6785, "food"),
      stop("Dinner at Trattoria Latte di Luna", 43.077, 11.6785, "food"),
    ])
  );
  assert.equal(near.colliding, 2, "44m apart is one point");

  const apart = scoreCoordinates(
    plan([
      stop("Lunch at Osteria Sette di Vino", 43.0766, 11.6785, "food"),
      stop("Dinner at Trattoria Latte di Luna", 43.0772, 11.6785, "food"),
    ])
  );
  assert.deepEqual(apart.collisions, [], "67m apart is two places");
});

test("a dropped coordinate is not a place two stops share", () => {
  // Mutation target: the (0,0) filter. Without it these collide in the Gulf of Guinea.
  const score = scoreCoordinates(
    plan([
      stop("Dinner at Osteria Acquacheta", 0, 0, "food"),
      stop("Lunch at Caffè Poliziano", 0, 0, "food"),
    ])
  );
  assert.equal(score.located, 0);
  assert.equal(score.normalized, null);
});

test("a plan that names no venue is unmeasured, not perfect", () => {
  const score = scoreCoordinates(
    plan([
      stop("Lunch around the old town", 43.0766, 11.6785, "food"),
      stop("Dinner around the old town", 43.0766, 11.6785, "food"),
    ])
  );
  assert.equal(score.named, 0);
  assert.equal(score.normalized, null, "null, so it cannot be averaged in as a pass");
});

test("a transit leg standing at the centre is not a venue", () => {
  // Mutation target: the transit exclusion on its own.
  const score = scoreCoordinates(
    plan([
      stop("Private taxi to Montalcino", 43.0766, 11.6785, "transit"),
      stop("Breakfast at Caffè Poliziano", 43.0766, 11.6785, "food"),
    ])
  );
  assert.deepEqual(score.collisions, []);
});

test("scoring reaches across days, because the defect did", () => {
  // The ten-stop cluster spanned all nine days; a per-day scorer would have seen ten clean days.
  const score = scoreCoordinates(
    plan(
      [stop("Breakfast at Caffè Poliziano", 43.0766, 11.6785, "food")],
      [stop("Breakfast at Bar Il Casello", 43.0766, 11.6785, "food")]
    )
  );
  assert.equal(score.colliding, 2);
});
