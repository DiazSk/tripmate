/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs
 *
 * `evaluateBudget` and `BudgetBar` show the traveler the same sum from two different places, and
 * this file exists because they must not disagree — two surfaces contradicting each other about
 * whether a trip is over budget is precisely the drift the contract docblock in itinerary.ts was
 * written about. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBudget, evaluateDay } from "./guardrails.ts";

/** One stop, one day, priced to whatever the case needs. */
const itineraryCosting = (cost) => ({
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

test("says nothing when there is no budget to compare against", () => {
  assert.deepEqual(evaluateBudget(itineraryCosting(500), 0), []);
});

/* --- The `realMinutes` seam ---
 *
 * `checkLegs` has always preferred a looked-up door-to-door duration over the haversine estimate,
 * and until `osrmRoute.ts` landed nothing anywhere passed one — so the branch shipped unexercised.
 * These two cover both of its directions, because the failure modes are opposite and both silent:
 * a lookup that is ignored leaves the plan validated against straight-line guesses, and a `null`
 * that skips the check instead of falling back drops the guardrail entirely for that leg. */

/** Two stops ten minutes apart on the clock and ~250m apart on the ground — a gap the estimate is
 *  comfortable with, so any finding here came from the injected lookup. */
const tightDay = {
  date: "2026-09-14",
  weather: "",
  stops: [
    { name: "Louvre", category: "entry", cost: 0, time: "10:00 AM", durationLabel: "1 hour", note: "", lat: 48.8606, lng: 2.3364 },
    { name: "Palais-Royal", category: "entry", cost: 0, time: "11:10 AM", durationLabel: "1 hour", note: "", lat: 48.8626, lng: 2.3376 },
  ],
};

test("a real duration overrides the estimate that would have passed", () => {
  assert.deepEqual(
    evaluateDay(tightDay, 0).filter((g) => g.rule === "travel"),
    [],
    "the estimate alone finds nothing here — otherwise the next assertion proves nothing"
  );

  const [finding] = evaluateDay(tightDay, 0, undefined, () => 45).filter((g) => g.rule === "travel");
  assert.equal(finding?.rule, "travel", "a measured 45-minute walk into a 10-minute gap must fire");
  assert.match(finding.message, /takes about 45 min, but only 10 min is left/);
});

test("an unroutable pair falls back to the estimate rather than skipping the check", () => {
  assert.deepEqual(
    evaluateDay(tightDay, 0, undefined, () => null),
    evaluateDay(tightDay, 0),
    "null means 'we could not answer', not 'there is nothing to check' — dropping the leg would silently retire the guardrail for every leg OSRM cannot reach"
  );
});
