import test from "node:test";
import assert from "node:assert/strict";
import { clearUnseenDay, markUnseenDays } from "./unseenChanges.ts";

test("1-based day numbers become 0-based indexes", () => {
  // The whole reason this is a function. The route reports what people read ("Day 2"); every
  // tab, marker and route colour is keyed on the array index.
  assert.deepEqual(markUnseenDays([2, 3], null), [1, 2]);
});

test("the day being watched is not marked", () => {
  // Its changes happened in front of the traveler; a dot there reads as an unread badge on a
  // message you already have open.
  assert.deepEqual(markUnseenDays([2, 3], 1), [2]);
});

test("marks accumulate across turns without duplicating", () => {
  const first = markUnseenDays([2], null);
  const second = markUnseenDays([2, 5], null, first);
  assert.deepEqual(second, [1, 4]);
});

test("a turn that changed nothing leaves the existing marks alone", () => {
  assert.deepEqual(markUnseenDays([], 0, [2, 3]), [2, 3]);
});

test("nonsense day numbers are dropped rather than marked", () => {
  // The dot promises there is a tab to go and look at. Day 0 and a fractional day have none.
  assert.deepEqual(markUnseenDays([0, -1, 1.5, 2], null), [1]);
});

test("the result is sorted, whatever order the route reported", () => {
  assert.deepEqual(markUnseenDays([5, 2, 9], null), [1, 4, 8]);
});

test("visiting a day clears only that day", () => {
  assert.deepEqual(clearUnseenDay([1, 2, 4], 2), [1, 4]);
  assert.deepEqual(clearUnseenDay([1, 2], 7), [1, 2]);
});

test("marking is a pure function of its inputs", () => {
  const existing = [3];
  markUnseenDays([1, 2], null, existing);
  assert.deepEqual(existing, [3]);
});
