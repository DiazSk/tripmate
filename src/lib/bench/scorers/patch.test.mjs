/* Run: npm test
 *
 * These metrics exist because applyPatch launders some bad output into plausible-looking trips:
 * add_stop clamps a wild index, replace_lodging is unchecked, and replace_stop merges rather than
 * overwrites. Each hole gets a test below, because `rejected` cannot see any of them — but they
 * don't all turn out to be equally visible once you look past `rejected`. add_stop and
 * replace_lodging both end up caught by guardrailDelta (pace, and budget, respectively).
 * replace_stop's merge does not: a near-empty payload applies as a clean, fully-applied edit, and
 * nothing in the current metric set notices. That gap is asserted directly rather than hidden
 * behind a test that happens to pass. */
import assert from "node:assert/strict";
import test from "node:test";
import { deltaGroups, refineComposite, scorePatch } from "./patch.ts";

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

test("replace_lodging is unchecked, but an absurd cost still flows into the budget guardrail", () => {
  // applyPatch assigns `op.lodging` straight onto the day with no shape check at all — any payload
  // "succeeds". The only reason this particular payload is visible afterward is that lodging cost
  // feeds tripSpend same as a stop's does, so an absurd number still trips §12d incidentally.
  const ops = [{ op: "replace_lodging", dayIndex: 0, lodging: { name: "Fake Hotel", cost: 99999 } }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 100 });
  assert.equal(s.opsRejected, 0, "replace_lodging has no validation of its payload — this is the hole");
  assert.ok(s.guardrailDelta > 0, "the cost side-effect is what catches it, not any check on the payload itself");
});

test("replace_stop's merge lets a near-empty payload pass as a full success, undetected", () => {
  // The model can send `{ name: "B (renamed)" }` for `stop`, and applyPatch merges it onto B rather
  // than requiring a full replacement — every other field, including time and cost, survives
  // untouched. opsRejected/applied read this as a clean, fully-applied edit, and because nothing
  // about the schedule or cost actually changed, no guardrail reacts either. Unlike the two holes
  // above, nothing in RefinePatchScore currently reveals this one — asserted here as a documented
  // gap, not papered over with an assertion that would only pass by accident.
  const ops = [{ op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: { name: "B (renamed)" } }];
  const s = scorePatch({ base, ops, task: { expect: { opsExpected: true, allowedDays: [0] } }, budget: 2000 });
  assert.equal(s.opsRejected, 0, "the merge means an incomplete payload is never rejected");
  assert.equal(s.applied, 1, "scorePatch reports a clean success even though only `name` actually changed");
  assert.equal(s.guardrailDelta, 0, "nothing about the schedule or cost changed, so no guardrail notices either");
});

test("refineComposite weights the delta by COMPOSITE_WEIGHTS, not evenly across the five groups", () => {
  // routeEfficiency (weight 0.15) and coverageGrounding (weight 0.30) both regress, the other three
  // groups hold steady. An even mean over 5 groups gives -0.5/5 = -0.1; weighting by
  // COMPOSITE_WEIGHTS and renormalizing over the two measurable groups' summed weight (1.0, since
  // every group is measurable here) gives (-0.4*0.15 + -0.1*0.30)/1.0 = -0.09 instead. The two
  // numbers must differ for this test to mean anything — if a future edit reverts to an even mean,
  // this assertion is what catches it.
  const delta = {
    routeEfficiency: -0.4,
    constraintAdherence: 0,
    weatherFeasibility: 0,
    mealVibeAlignment: 0,
    coverageGrounding: -0.1,
  };
  const scores = { delta, patch: { normalized: 1 }, operational: { failed: false } };
  const c = refineComposite(scores);
  assert.ok(Math.abs(c - 0.955) < 1e-9, `expected the weighted composite 0.955, got ${c}`);
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
