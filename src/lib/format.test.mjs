/* Run: node --test src/lib/format.test.mjs
 *
 * Only the clock formatter is covered. The date helpers wrap `toLocaleDateString`, which is the
 * platform's problem; 12-hour conversion is ours, and both of its edge cases are the kind that
 * read fine and ship wrong. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatClockLabel, formatDistance, formatDuration } from "./format.ts";

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

/* --- Distance and duration ---
 *
 * Both are read straight off an OSRM response, and both have a boundary that is invisible until
 * someone sees it on screen: the metre/kilometre switch, and the minute floor. The floor is the
 * one that matters — "0 min" reads as "no distance at all" rather than "next door", and a reader
 * deciding whether to walk needs those to look different. */

test("distance switches to kilometres at 1000m and stops claiming metres it does not have", () => {
  assert.equal(formatDistance(940), "940 m");
  assert.equal(formatDistance(944), "940 m", "rounds to 10m — a route's endpoints are snapped to the pavement, so the last digit was never real");
  assert.equal(formatDistance(999), "1 km", "rounding happens before the unit is chosen, so there is no 1000m state");
  assert.equal(formatDistance(1000), "1 km");
  assert.equal(formatDistance(1249), "1.2 km");
  assert.equal(formatDistance(12345), "12.3 km");
});

test("duration floors at a minute and names the hour", () => {
  assert.equal(formatDuration(24), "1 min", "a forty-second hop is 'next door', not 'no distance'");
  assert.equal(formatDuration(59), "1 min");
  assert.equal(formatDuration(512.1), "9 min", "the live Louvre to Palais-Royal walk");
  assert.equal(formatDuration(3600), "1 hr", "an exact hour is not '1 hr 0 min'");
  assert.equal(formatDuration(3900), "1 hr 5 min");
});

test("neither invents a number out of a broken one", () => {
  assert.equal(formatDistance(NaN), "0 m");
  assert.equal(formatDistance(-5), "0 m");
  assert.equal(formatDuration(NaN), "1 min");
  assert.equal(formatDuration(0), "1 min");
});
