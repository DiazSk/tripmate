/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/tiers.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { closestTier, perPersonBudget, tripDays } from "./tiers.ts";
import { planExamples } from "./planExamples.ts";

test("a whole-party budget is split across everyone, infants included; a per-person one is not", () => {
  assert.equal(perPersonBudget(4200, "whole_party", 2), 2100);
  assert.equal(perPersonBudget(4200, undefined, 2), 2100);
  assert.equal(perPersonBudget(4200, "per_person", 2), 4200);
  assert.equal(perPersonBudget(900, "whole_party", 0), 900);
});

// The planner run that found it: two adults, six days, $4,200 for everyone. Each has $350 a day,
// a Mid-range trip; matching the total against one person's estimate called it Luxury.
test("a couple's shared budget is priced per person", () => {
  assert.equal(closestTier(perPersonBudget(4200, "whole_party", 2), 6), "midrange");
  assert.equal(closestTier(4200, 6), "luxury");
});

// The landing's cards say which style each trip is (planExamples.ts). Opening one prefills its
// total and its party, so the tier the planner then derives has to be the one the card claims.
test("every sample plan lands on the tier its card claims", () => {
  const claimed = { tuscany: "midrange", jaipur: "budget", sinaia: "midrange", "wadi-rum": "budget" };
  for (const e of planExamples) {
    const share = perPersonBudget(e.budgetUsd, "whole_party", e.adults + e.children);
    assert.equal(closestTier(share, e.days), claimed[e.id], e.id);
  }
});

test("a date that doesn't parse is one day, not NaN", () => {
  assert.equal(tripDays("2026-05-01", "not a date"), 1);
  assert.equal(tripDays("2026-05-01", "2026-05-03"), 3);
});
