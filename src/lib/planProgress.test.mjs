/* Run: node --test src/lib/planProgress.test.mjs
 *
 * The writing screen said "7 days" (from the dates) while the capsule said "6 days" (the rows the
 * stream had reached), and a sketch frame, which fills every day with no stops, read "Day 9 of 9". */
import assert from "node:assert/strict";
import test from "node:test";
import { capsuleDays, dayOfLabel, daysLabel, tripLength, writtenDays } from "./planProgress.ts";
import { tripDays } from "./tiers.ts";

const day = (n) => ({ stops: Array.from({ length: n }, () => ({})) });
const rows = (...counts) => counts.map(day);

test("a 7-day trip with 6 streamed days is 7 long, not 6", () => {
  const total = tripLength(tripDays("2026-11-07", "2026-11-13"), 6);
  assert.equal(total, 7);
  assert.equal(daysLabel(total), "7 days");
  assert.equal(dayOfLabel(6, total), "Day 6 of 7");
});

test("a sketch frame (every day, no stops) has written nothing, so no Day 9 of 9", () => {
  const sketch = rows(0, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(writtenDays(sketch), 0);
  assert.deepEqual(capsuleDays({ days: sketch, streaming: true, tripDays: 9, activeDayIndex: 0 }), { subtitle: "9 days", step: undefined });
});

test("stops on days 1 and 4 only: the last day with a stop is written", () => {
  assert.equal(writtenDays(rows(2, 0, 0, 3, 0, 0, 0, 0, 0)), 4);
  assert.deepEqual(capsuleDays({ days: rows(2, 0, 0, 3, 0, 0, 0, 0, 0), streaming: true, tripDays: 9, activeDayIndex: 0 }), {
    subtitle: "9 days",
    step: "Day 4 of 9",
  });
});

test("writtenDays tolerates no draft", () => {
  assert.equal(writtenDays(null), 0);
  assert.equal(writtenDays(undefined), 0);
  assert.equal(writtenDays([]), 0);
});

test("more streamed days than the dates allow: the stream wins, never Day 8 of 7", () => {
  assert.equal(tripLength(7, 8), 8);
  assert.deepEqual(capsuleDays({ days: rows(1, 1, 1, 1, 1, 1, 1, 1), streaming: true, tripDays: 7, activeDayIndex: 0 }), {
    subtitle: "8 days",
    step: "Day 8 of 8",
  });
});

test("a 1-day trip", () => {
  assert.equal(tripLength(1, 1), 1);
  assert.equal(daysLabel(1), "1 day");
  assert.deepEqual(capsuleDays({ days: rows(2), streaming: true, tripDays: 1, activeDayIndex: 0 }), { subtitle: "1 day", step: "Day 1 of 1" });
});

test("no dates: the streamed count stands, and never below one", () => {
  assert.equal(tripLength(null, 4), 4);
  assert.equal(tripLength(undefined, 0), 1);
  assert.deepEqual(capsuleDays({ days: rows(2, 2, 2, 2), streaming: true, tripDays: null, activeDayIndex: 0 }), {
    subtitle: "4 days",
    step: "Day 4 of 4",
  });
});

test("once the plan is whole the capsule is the finished plan's: its days and the day in focus", () => {
  assert.deepEqual(capsuleDays({ days: rows(3, 3, 3), streaming: false, tripDays: 7, activeDayIndex: 1 }), { subtitle: "3 days", step: "Day 2" });
  assert.deepEqual(capsuleDays({ days: [], streaming: false, tripDays: 7, activeDayIndex: 0 }), { subtitle: undefined, step: undefined });
});
