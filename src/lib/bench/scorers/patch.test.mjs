/* Run: npm test
 *
 * These metrics exist because applyPatch launders some bad output into plausible-looking trips:
 * add_stop clamps a wild index, replace_lodging is unchecked, replace_stop merges. Each of those
 * holes gets a test here, because `rejected` cannot see any of them. */
import assert from "node:assert/strict";
import test from "node:test";
import { deltaGroups, scorePatch } from "./patch.ts";

const stop = (name, time, cost = 10) => ({
  name, lat: 43.08, lng: 11.68, cost, why: "because", note: "5-minute walk",
  time, durationLabel: "1 hour", category: "other",
});

const base = {
  tier: "balanced",
  days: [
    { date: "2026-09-12", weather: "sunny", stops: [stop("A", "9:00 AM"), stop("B", "1:00 PM")] },
    { date: "2026-09-13", weather: "sunny", stops: [stop("C", "10:00 AM")] },
  ],
};

test("a clean in-scope patch scores well", () => {
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: stop("B2", "2:00 PM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.opsEmitted, 1);
  assert.equal(s.opsRejected, 0);
  assert.equal(s.applied, 1);
  assert.equal(s.scope, 1);
  assert.equal(s.restraint, true);
});

test("a hallucinated day index is rejected and scored down", () => {
  const ops = [{ op: "replace_stop", dayIndex: 9, stopIndex: 0, stop: stop("X", "9:00 AM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true } }, budget: 2000 });
  assert.equal(s.opsRejected, 1);
  assert.equal(s.applied, 0);
  assert.match(s.rejectedReasons[0], /out of range/);
});

test("editing a day the task ruled out costs scope, even though applyPatch allows it", () => {
  const ops = [{ op: "replace_stop", dayIndex: 1, stopIndex: 0, stop: stop("C2", "11:00 AM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.applied, 1, "it applied — applyPatch has no opinion about the task's scope");
  assert.equal(s.scope, 0, "but it touched a day the task forbade");
});

test("changing a plan that was only asked about fails restraint", () => {
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: stop("A2", "9:30 AM") }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: false } }, budget: 2000 });
  assert.equal(s.restraint, false);
  assert.ok(s.normalized < 1);
});

test("answering a question with no ops satisfies restraint", () => {
  const s = scorePatch({ base, ops: [], task: { expect: { opsExpected: false } }, budget: 2000 });
  assert.equal(s.restraint, true);
  assert.equal(s.applied, null, "no ops means applied is unmeasurable, not zero");
});

test("add_stop's clamped index is caught by the guardrail delta, not by rejection", () => {
  // stopIndex 99 on a 2-stop day: applyPatch clamps to the end and reports no rejection.
  const ops = [
    { op: "add_stop", dayIndex: 0, stopIndex: 99, stop: stop("Late", "11:30 PM") },
  ];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.opsRejected, 0, "applyPatch clamps rather than rejecting — this is the hole");
  assert.ok(s.guardrailDelta > 0, "the guardrail delta is what notices the damage");
});

test("blowing the budget shows up as a new guardrail", () => {
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: stop("Gold", "9:00 AM", 99999) }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 100 });
  assert.ok(s.guardrailsAfter > s.guardrailsBefore);
});

test("deltaGroups subtracts per group and keeps nulls null", () => {
  const d = deltaGroups(
    { routeEfficiency: 0.8, constraintAdherence: 0.9, weatherFeasibility: null, mealVibeAlignment: 0.5, coverageGrounding: 0.7 },
    { routeEfficiency: 0.6, constraintAdherence: 0.9, weatherFeasibility: 0.4, mealVibeAlignment: 0.5, coverageGrounding: 0.7 }
  );
  assert.ok(Math.abs(d.routeEfficiency - -0.2) < 1e-9);
  assert.equal(d.constraintAdherence, 0);
  assert.equal(d.weatherFeasibility, null, "unmeasurable on one side means unmeasurable in the delta");
});
