import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FIT_DISTANCE_M,
  MIN_DAY_RADIUS_M,
  rankDaysForPlace,
  suggestDayForPlace,
} from "./dayFit.ts";

/** Rome, roughly. Coordinates below are offsets from here so the distances are easy to reason
 *  about: at this latitude 0.01° of latitude is ~1.11km. */
const BASE = { lat: 41.9, lng: 12.5 };
const at = (dLat, dLng = 0) => ({ lat: BASE.lat + dLat, lng: BASE.lng + dLng });

test("an empty trip has nothing to suggest", () => {
  assert.equal(suggestDayForPlace(BASE, []), null);
});

test("days with no stops are ranked but never recommended", () => {
  const days = [
    { day: 0, stops: [] },
    { day: 1, stops: [] },
  ];
  const ranked = rankDaysForPlace(BASE, days);
  assert.equal(ranked.length, 2, "every day is still listed for the picker");
  assert.ok(ranked.every((d) => d.score === Number.POSITIVE_INFINITY));
  assert.equal(suggestDayForPlace(BASE, days), null, "geometry cannot justify an empty day");
});

test("a day with stops beats an empty one, whatever the order in", () => {
  const days = [
    { day: 0, stops: [] },
    { day: 1, stops: [at(0.02), at(0.03)] },
  ];
  assert.equal(suggestDayForPlace(BASE, days).day, 1);
  assert.equal(rankDaysForPlace(BASE, days)[0].day, 1, "finite scores sort ahead of Infinity");
});

test("the obvious case: the point sits inside one day's cluster", () => {
  const days = [
    { day: 0, stops: [at(0.001), at(-0.001, 0.001)] },   // right on top of the point
    { day: 1, stops: [at(0.4), at(0.41)] },              // ~45km north
  ];
  assert.equal(suggestDayForPlace(BASE, days).day, 0);
});

// --- the normalisation, which is the whole reason this is not raw centroid distance ------------

test("a tight day judges a nearby point as a worse fit than a sprawling day judges a far one", () => {
  // Day 0 spans ~12km and its centroid lands 3.8km from the point.
  // Day 1 is a pocket ~1.1km across whose centroid is 1.0km away.
  // Raw distance says day 1; normalised says day 0, because 1.0km is a long way for that pocket
  // and 3.8km is well inside a day that already moves 12km.
  const days = [
    { day: 0, stops: [at(0.0), at(0.055), at(0.11)] },
    { day: 1, stops: [at(-0.009, 0.001), at(-0.0095), at(-0.0085, -0.001)] },
  ];
  const ranked = rankDaysForPlace(BASE, days);
  assert.ok(
    ranked[0].distanceM > ranked[1].distanceM,
    "the recommended day must be the geometrically *further* one, or this test proves nothing"
  );
  assert.equal(ranked[0].day, 0);
});

test("raw distance still decides between two days of the same spread", () => {
  const days = [
    { day: 0, stops: [at(0.02), at(0.03), at(0.04)] },
    { day: 1, stops: [at(0.2), at(0.21), at(0.22)] },
  ];
  assert.equal(suggestDayForPlace(BASE, days).day, 0);
});

test("one outlier does not turn a compact day into one that welcomes anything", () => {
  // Four stops in a pocket plus Fushimi-Inari-style outlier 12km out. The mean radius keeps the
  // day's tolerance near its real size, so a point 8km away on the other side is not a fit.
  const withOutlier = {
    day: 0,
    stops: [at(0.0), at(0.002), at(0.004), at(0.001, 0.002), at(0.108)],
  };
  const compact = { day: 1, stops: [at(-0.07), at(-0.072), at(-0.074)] };
  const point = at(-0.072, 0.001); // sitting inside day 1
  assert.equal(suggestDayForPlace(point, [withOutlier, compact]).day, 1);
});

// --- the floor and the ceiling ------------------------------------------------------------------

test("a single-stop day is recommendable rather than dividing by a zero radius", () => {
  const days = [{ day: 0, stops: [at(0.001)] }];
  const fit = suggestDayForPlace(BASE, days);
  assert.ok(fit, "a one-stop day must still be able to win");
  assert.ok(Number.isFinite(fit.score), `expected a finite score, got ${fit.score}`);
  // Radius floors at MIN_DAY_RADIUS_M, so the score is the distance measured against that.
  assert.ok(Math.abs(fit.score - fit.distanceM / MIN_DAY_RADIUS_M) < 1e-9);
});

test("a place in another city is not a fit for any day", () => {
  const days = [{ day: 0, stops: [at(0.0), at(0.01)] }];
  const faraway = { lat: BASE.lat + 6, lng: BASE.lng + 6 }; // several hundred km
  assert.ok(rankDaysForPlace(faraway, days)[0].distanceM > MAX_FIT_DISTANCE_M);
  assert.equal(suggestDayForPlace(faraway, days), null);
});

test("ties break on the earlier day, so the suggestion is stable", () => {
  const mirror = [
    { day: 2, stops: [at(0.01), at(-0.01)] },
    { day: 0, stops: [at(0.01), at(-0.01)] },
  ];
  assert.equal(suggestDayForPlace(BASE, mirror).day, 0);
});

test("every day comes back ranked, so the picker can label the whole list", () => {
  const days = [
    { day: 0, stops: [at(0.3)] },
    { day: 1, stops: [] },
    { day: 2, stops: [at(0.001)] },
  ];
  const ranked = rankDaysForPlace(BASE, days);
  assert.deepEqual(
    [...ranked].map((d) => d.day).sort(),
    [0, 1, 2],
    "no day may be dropped — the list is the picker"
  );
  assert.equal(ranked[0].day, 2);
});
