/* Run: node --test src/lib/generationStages.test.mjs
 *
 * A typo'd stage id here silently breaks the loader for exactly one stage — no crash, no
 * test failure elsewhere, just a step that never gets a caption. These asserts exist so
 * that class of typo fails here instead of showing up as a blank loader row. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  STAGE_ORDER,
  STAGE_SECONDS,
  STEP_GROUPS,
  generationProgress,
  isStepTerminal,
  stageMeta,
  stepGroupState,
} from "./generationStages.ts";

/** Builds a stages array from a partial map, defaulting anything unnamed to `pending`. */
const at = (overrides) => STAGE_ORDER.map((stage) => ({ stage, status: overrides[stage] ?? "pending" }));

const ALL_DONE = at({
  geocode: "done",
  context: "done",
  generate: "done",
  critique: "done",
  placing: "done",
});

test("STAGE_ORDER has exactly the five documented stages, no duplicates", () => {
  assert.deepEqual(STAGE_ORDER, ["geocode", "context", "generate", "critique", "placing"]);
  assert.equal(new Set(STAGE_ORDER).size, STAGE_ORDER.length);
});

test("every stage has a non-empty label and caption list in both modes", () => {
  for (const mode of ["generate", "refine"]) {
    for (const stage of STAGE_ORDER) {
      const meta = stageMeta(mode, stage);
      assert.ok(meta.label.length > 0, `${mode}/${stage} has no label`);
      assert.ok(meta.captions.length > 0, `${mode}/${stage} has no captions`);
    }
  }
});

test("refine's generate stage uses the Reworking label, not Planning", () => {
  assert.equal(stageMeta("refine", "generate").label, "Reworking");
  assert.equal(stageMeta("generate", "generate").label, "Planning");
});

test("STAGE_SECONDS covers exactly STAGE_ORDER, all positive", () => {
  assert.deepEqual(Object.keys(STAGE_SECONDS).sort(), [...STAGE_ORDER].sort());
  for (const stage of STAGE_ORDER) {
    assert.ok(STAGE_SECONDS[stage] > 0, `${stage} has a non-positive weight`);
  }
});

/* The whole reason the bar is weighted. If someone ever flattens these to equal values the
 * bar silently goes back to jumping to 40% and freezing for minutes, which looks like a hang.
 * That regression should fail here, loudly, rather than be discovered by a user.
 *
 * This used to assert `generate` was the single largest stage and over half the total. That
 * stopped being true when the weights were re-derived on 2026-08-21: measured p50s are generate
 * 145s and critique 146s, and critique is the MORE censored of the two (6 of 18 killed vs 2 of
 * 32), so its real cost is higher still. The review step now costs at least as much as writing
 * the plan. So the invariant worth pinning is that the two model calls TOGETHER dominate — which
 * is what makes the bar's shape necessary — not which of them happens to be bigger. */
test("the two model-call stages dominate — equal segments would be a lie", () => {
  const total = Object.values(STAGE_SECONDS).reduce((a, b) => a + b, 0);
  const modelCalls = STAGE_SECONDS.generate + STAGE_SECONDS.critique;
  assert.ok(modelCalls / total > 0.8, `model calls are only ${Math.round((modelCalls / total) * 100)}% of the total`);
  const largest = Math.max(...Object.values(STAGE_SECONDS));
  const smallest = Math.min(...Object.values(STAGE_SECONDS));
  assert.ok(largest / smallest > 10, "weights have been flattened toward equal segments");
});

test("an all-pending run returns 0, ignoring any previous value", () => {
  assert.equal(generationProgress(at({}), 0, 0), 0);
  assert.equal(generationProgress(at({}), 50_000, 0.9), 0);
});

test("an all-done run returns exactly 1", () => {
  assert.equal(generationProgress(ALL_DONE, 0, 0), 1);
});

test("the running stage's fill never reaches the end of its own segment", () => {
  const stages = at({ geocode: "done", context: "done", generate: "start" });
  const total = Object.values(STAGE_SECONDS).reduce((a, b) => a + b, 0);
  const segmentStart = (STAGE_SECONDS.geocode + STAGE_SECONDS.context) / total;
  const segmentEnd = segmentStart + STAGE_SECONDS.generate / total;

  // Ten times the expected duration — far past any real run.
  const v = generationProgress(stages, STAGE_SECONDS.generate * 1000 * 10, 0);
  assert.ok(v > segmentStart, "should have moved past the segment start");
  assert.ok(v < segmentEnd, "must never complete the segment without a done event");
});

test("progress strictly increases with elapsed time inside a stage", () => {
  const stages = at({ geocode: "done", context: "done", generate: "start" });
  let last = -1;
  for (const ms of [1_000, 10_000, 60_000, 300_000]) {
    const v = generationProgress(stages, ms, 0);
    assert.ok(v > last, `${ms}ms should exceed the previous sample`);
    last = v;
  }
});

/* Replays the real emission order from generationRunner.ts, including the deliberate overlap
 * where `context: start` is fired before `geocode: start` so the context call runs
 * concurrently. A walk-until-first-pending implementation returns 0 through that window and
 * then jumps; this asserts the bar only ever moves forward. */
test("progress is monotone across a real generate run, overlap included", () => {
  const script = [
    [{ context: "start" }, 0],
    [{ context: "start", geocode: "start" }, 200],
    [{ context: "start", geocode: "done" }, 900],
    [{ context: "done", geocode: "done" }, 100],
    [{ context: "done", geocode: "done", generate: "start" }, 30_000],
    [{ context: "done", geocode: "done", generate: "start" }, 95_000],
    [{ context: "done", geocode: "done", generate: "done" }, 0],
    [{ context: "done", geocode: "done", generate: "done", critique: "start" }, 40_000],
    [{ context: "done", geocode: "done", generate: "done", critique: "done" }, 0],
    [
      { context: "done", geocode: "done", generate: "done", critique: "done", placing: "start" },
      2_000,
    ],
    [
      { context: "done", geocode: "done", generate: "done", critique: "done", placing: "done" },
      0,
    ],
  ];

  let previous = 0;
  for (const [overrides, elapsed] of script) {
    const v = generationProgress(at(overrides), elapsed, previous);
    assert.ok(v >= previous, `regressed at ${JSON.stringify(overrides)}: ${v} < ${previous}`);
    assert.ok(v <= 1, `exceeded 1 at ${JSON.stringify(overrides)}`);
    previous = v;
  }
  assert.equal(previous, 1);
});

test("skipped stages leave the denominator so refine still reaches 1", () => {
  const refineDone = at({
    geocode: "skipped",
    context: "done",
    generate: "done",
    critique: "done",
    placing: "skipped",
  });
  // The trap this guards: a fixed denominator would cap refine at ~96.7% forever.
  assert.equal(generationProgress(refineDone, 0, 0), 1);
});

test("skipping a stage advances the bar past leaving it pending", () => {
  const shared = { context: "done", generate: "done" };
  const skipped = generationProgress(at({ ...shared, geocode: "skipped", placing: "skipped" }), 0, 0);
  const pending = generationProgress(at(shared), 0, 0);
  assert.ok(skipped > pending, "removing weight should raise the completed fraction");
});

test("previous clamps a lower computed value and 1 stays 1", () => {
  const early = at({ geocode: "done", context: "start" });
  assert.equal(generationProgress(early, 0, 0.8), 0.8);
  assert.equal(generationProgress(ALL_DONE, 10 ** 9, 1), 1);
});

/* --- The lie this file exists to prevent -------------------------------------------------------
 *
 * A timed-out critique used to report `skipped`. Every stage in the "Checking it over" group was
 * then skipped, the empty-group rule collapsed that to `done`, and the loader told the traveller
 * their plan had been quality-checked when the review never ran. These assert the distinction that
 * fixes it, and the refine behaviour that made the empty-group rule correct in the first place. */

const CHECK = STEP_GROUPS.find((g) => g.id === "check");
const PLACE = STEP_GROUPS.find((g) => g.id === "place");
const READ = STEP_GROUPS.find((g) => g.id === "read");

test("the check group holds critique alone — which is why a skip there was invisible", () => {
  assert.deepEqual([...CHECK.stages], ["critique"], "if this grows, re-read stepGroupState");
});

test("a FAILED critique never reports done", () => {
  const state = stepGroupState(CHECK, at({ generate: "done", critique: "failed" }));
  assert.equal(state, "failed", "a review that timed out must not render as done");
});

test("a failed step is terminal, so the loader can still finish", () => {
  assert.equal(isStepTerminal("failed"), true);
  assert.equal(isStepTerminal("done"), true);
  assert.equal(isStepTerminal("waiting"), false);
  assert.equal(isStepTerminal("active"), false);
});

test("refine's legitimately skipped group still reports done", () => {
  // The empty-group rule was never the bug: refine reuses the previous itinerary's coordinates,
  // so `placing` genuinely had nothing to do and "done" is honest there.
  assert.equal(stepGroupState(PLACE, at({ placing: "skipped" })), "done");
});

test("a skipped geocode is hidden by its live sibling, not laundered", () => {
  // This is why geocode was left on `skipped`: its group reports context's real state either way.
  assert.equal(stepGroupState(READ, at({ geocode: "skipped", context: "start" })), "active");
  assert.equal(stepGroupState(READ, at({ geocode: "skipped", context: "done" })), "done");
});

test("a group with one failed stage reports failed even when a sibling succeeded", () => {
  assert.equal(stepGroupState(READ, at({ geocode: "failed", context: "done" })), "failed");
});

test("a running stage outranks a failed sibling — the group is still active", () => {
  assert.equal(stepGroupState(READ, at({ geocode: "failed", context: "start" })), "active");
});

test("failed weight counts as SPENT, unlike skipped which leaves the denominator", () => {
  const shared = { geocode: "done", context: "done", generate: "done" };
  const failed = generationProgress(at({ ...shared, critique: "failed" }), 0, 0);
  const pending = generationProgress(at({ ...shared, critique: "pending" }), 0, 0);
  assert.ok(
    failed > pending,
    "a critique that burned its whole budget must advance the bar, not stall it"
  );

  // `failed` is credited exactly as `done` is — weight in both numerator and denominator — because
  // the stage really ran. `skipped` removes it from both, which is a different denominator and so
  // a different fraction. Asserting the two identities directly rather than comparing fractions,
  // whose ordering depends on which stages are still pending and is easy to reason about wrongly.
  const done = generationProgress(at({ ...shared, critique: "done" }), 0, 0);
  assert.equal(failed, done, "a spent-but-failed stage advances the bar exactly like a done one");
  const skipped = generationProgress(at({ ...shared, critique: "skipped" }), 0, 0);
  assert.notEqual(skipped, failed, "skipped drops the weight from the denominator; failed keeps it");
});

test("a run reporting only a failure is not mistaken for a run that has not started", () => {
  assert.ok(generationProgress(at({ critique: "failed" }), 0, 0) > 0);
});

test("STAGE_SECONDS states a wait that matches what the calls actually take", () => {
  // Re-derived 2026-08-21 from llm_traces (censored rows included): context p50 24s at a ~47%
  // cache-miss rate, generate p50 145s, critique p50 146s. The old values summed to 151s and
  // promised "two and a half minutes" for what measurably takes about five.
  const total = Object.values(STAGE_SECONDS).reduce((a, b) => a + b, 0);
  assert.ok(total > 250, `sum is ${total}s — under 250s means someone reverted to a stale estimate`);
  assert.equal(STAGE_SECONDS.generate, 145);
  assert.equal(STAGE_SECONDS.critique, 150);
  // The number the loader actually speaks, computed exactly as GenerationScreen does.
  assert.equal(Math.round((total / 60) * 2) / 2, 5);
});
