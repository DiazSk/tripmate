/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/exportPhotos.test.mjs
 *
 * Only the budget arithmetic and the fail-soft contract are covered — the fetching itself is
 * Wikipedia's. What matters here is that no failure mode can take the export down with it. */
import assert from "node:assert/strict";
import test from "node:test";
import { withinBudget, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES } from "./exportPhotos.ts";

test("an oversized single image is refused", () => {
  assert.equal(withinBudget(MAX_IMAGE_BYTES + 1, 0), false);
  assert.equal(withinBudget(MAX_IMAGE_BYTES, 0), true);
});

test("images are refused once the running total is spent", () => {
  assert.equal(withinBudget(1000, MAX_TOTAL_BYTES), false);
  assert.equal(withinBudget(1000, MAX_TOTAL_BYTES - 1000), true);
});

test("the caps leave room for a cover plus a week of thumbs", () => {
  // Measured against the saved Zurich trip: cover ~233KB, day thumbs ~27KB mean.
  assert.ok(MAX_TOTAL_BYTES > 233_000 + 27_000 * 7, "a 7-day trip must fit comfortably");
});
