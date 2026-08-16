/* Run: node --test src/lib/userAnswers.test.mjs
 *
 * These weights decide how full a day feels, and they are the first thing anyone
 * will adjust after reading a few real itineraries. The asserts pin the two ends
 * of the range and the floor, so a tuning change that accidentally collapses the
 * scale fails here instead of in a generated trip. */
import assert from "node:assert/strict";
import test from "node:test";
import { deriveFlags, derivePaceSpotsPerDay, labelPace, PACE_FLOOR } from "./userAnswers.ts";

const answers = (over) => ({
  purpose: "leisure",
  explorerStyle: "mixed",
  group: "solo",
  energy: "moderate",
  crowds: "mixed",
  budget: 1000,
  priorities: [],
  topPriorities: [],
  selectedPois: [],
  customPois: [],
  ...over,
});

test("a packed, high-energy solo traveler gets the top of the range", () => {
  assert.equal(derivePaceSpotsPerDay("packed", "solo", "high"), 5);
  assert.equal(labelPace(5), "fast");
});

test("energy and kids step the pace down, and the floor holds", () => {
  // relaxed ceiling 3, low energy -2, family -1 = 0, floored to PACE_FLOOR.
  assert.equal(derivePaceSpotsPerDay("relaxed", "family_with_kids", "low"), PACE_FLOOR);
  assert.equal(labelPace(PACE_FLOOR), "slow");
});

test("a low-energy traveler gets every mobility constraint set", () => {
  const flags = deriveFlags(answers({ energy: "low" }));
  assert.deepEqual(flags.mobilityProfile, {
    walkLegCap: "tight",
    minimizeStairs: true,
    restBreaks: true,
    preferTransitOverLongWalks: true,
  });
});

test("familyRules is null for anyone not travelling with kids", () => {
  assert.equal(deriveFlags(answers({ group: "solo" })).familyRules, null);
  assert.ok(deriveFlags(answers({ group: "family_with_kids" })).familyRules);
});

test("an unrecognized explorer style falls back instead of producing NaN", () => {
  // @ts-expect-error — deliberately passing a value outside the enum to prove the fallback
  const result = derivePaceSpotsPerDay("bogus", "solo", "high");
  assert.ok(Number.isFinite(result), `expected a finite number, got ${result}`);
});

test("starred priorities become primary, the rest tiebreakers", () => {
  const flags = deriveFlags(
    answers({ priorities: ["Food", "Nightlife", "Shopping"], topPriorities: ["Food"] })
  );
  assert.deepEqual(flags.prioritiesRanked, {
    primary: ["Food"],
    tiebreakers: ["Nightlife", "Shopping"],
  });
});
