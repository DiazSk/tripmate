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
  generationProgress,
  stageMeta,
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
 * bar silently goes back to jumping to 40% and freezing for 90 seconds, which looks like a
 * hang. That regression should fail here, loudly, rather than be discovered by a user. */
test("generate dominates the weighting — equal segments would be a lie", () => {
  const total = Object.values(STAGE_SECONDS).reduce((a, b) => a + b, 0);
  const largest = Math.max(...Object.values(STAGE_SECONDS));
  assert.equal(STAGE_SECONDS.generate, largest);
  assert.ok(STAGE_SECONDS.generate / total > 0.5, "generate should be over half the total");
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
