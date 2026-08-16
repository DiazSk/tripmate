/* Run: node --test src/lib/generationStages.test.mjs
 *
 * A typo'd stage id here silently breaks the loader for exactly one stage — no crash, no
 * test failure elsewhere, just a step that never gets a caption. These asserts exist so
 * that class of typo fails here instead of showing up as a blank loader row. */
import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_ORDER, stageMeta } from "./generationStages.ts";

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
