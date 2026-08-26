/* Run: node --test src/lib/guardrails.test.mjs
 *
 * `evaluateBudget` and `BudgetBar` show the traveler the same sum from two different places, and
 * this file exists because they must not disagree — two surfaces contradicting each other about
 * whether a trip is over budget is precisely the drift the contract docblock in itinerary.ts was
 * written about.
 *
 * The load-bearing case is a plan that fits on stops alone but NOT once real airfare counts. That
 * became reachable the moment the model started planning against `budget − flights`: its output is
 * now always comfortably inside the stated budget, so without counting the flight this warning
 * could effectively never fire again — and the one situation it exists for (a trip that genuinely
 * costs more than the traveler said) would have gone silent. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBudget } from "./guardrails.ts";

/** One stop, one day, priced to whatever the case needs. */
const itineraryCosting = (cost, extra = {}) => ({
  tier: "midrange",
  days: [
    {
      date: "2026-09-14",
      weather: "",
      stops: [
        { name: "A museum", category: "entry", cost, time: "10:00 AM", durationLabel: "1 hour", note: "", lat: 0, lng: 0 },
      ],
    },
  ],
  ...extra,
});

test("says nothing when the plan is inside the budget", () => {
  assert.deepEqual(evaluateBudget(itineraryCosting(300), 1000), []);
});

test("fires when the plan alone exceeds the budget", () => {
  const [finding] = evaluateBudget(itineraryCosting(1200), 1000);
  assert.equal(finding.rule, "budget");
  assert.equal(finding.dayIndex, null, "budget is trip-wide, not a per-day finding");
  assert.match(finding.message, /200 over your \$1000 budget/);
});

test("counts real airfare, so a plan that only fits without it still reports over budget", () => {
  // The case the whole file is for: $300 of stops against a $1,000 budget looks fine, and is
  // fine — until the $800 flight that was already deducted before planning is counted back in.
  assert.deepEqual(evaluateBudget(itineraryCosting(300), 1000), [], "sanity: fine without flights");
  const [finding] = evaluateBudget(itineraryCosting(300, { flightCostUsd: 800 }), 1000);
  assert.equal(finding.rule, "budget");
  assert.match(finding.message, /100 over your \$1000 budget/);
});

test("an itinerary with no flight cost behaves exactly as before", () => {
  // Trips with no origin, and every itinerary saved before the field existed.
  const withField = evaluateBudget(itineraryCosting(1200, { flightCostUsd: undefined }), 1000);
  const withoutField = evaluateBudget(itineraryCosting(1200), 1000);
  assert.deepEqual(withField, withoutField);
});

test("a flight cost alone can push an otherwise-free plan over", () => {
  const [finding] = evaluateBudget(itineraryCosting(0, { flightCostUsd: 1455 }), 1000);
  assert.match(finding.message, /455 over your \$1000 budget/);
});

test("says nothing when there is no budget to compare against", () => {
  assert.deepEqual(evaluateBudget(itineraryCosting(500, { flightCostUsd: 900 }), 0), []);
});
