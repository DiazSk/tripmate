/* Run: node --test src/lib/format.test.mjs
 *
 * Only the clock formatter is covered. The date helpers wrap `toLocaleDateString`, which is the
 * platform's problem; 12-hour conversion is ours, and both of its edge cases are the kind that
 * read fine and ship wrong. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatClockLabel } from "./format.ts";

test("the two hours that a bare modulo gets wrong", () => {
  assert.equal(formatClockLabel("00:15"), "12:15 AM", "midnight is 12 AM, not 0 AM");
  assert.equal(formatClockLabel("12:00"), "12:00 PM", "noon is PM, and 12 rather than 0");
});

test("either side of noon and midnight", () => {
  assert.equal(formatClockLabel("00:00"), "12:00 AM");
  assert.equal(formatClockLabel("11:59"), "11:59 AM");
  assert.equal(formatClockLabel("12:01"), "12:01 PM");
  assert.equal(formatClockLabel("23:45"), "11:45 PM");
});

test("a leading zero is dropped from the hour but never the minute", () => {
  assert.equal(formatClockLabel("08:05"), "8:05 AM");
  assert.equal(formatClockLabel("20:15"), "8:15 PM");
});

test("anything that isn't a clock time comes back untouched", () => {
  // The form only ever supplies values it generated, but a stored trip can carry anything.
  for (const bad of ["", "25:99", "8:15 PM", "nonsense"]) {
    assert.equal(formatClockLabel(bad), bad);
  }
  assert.equal(formatClockLabel(null), "");
});
