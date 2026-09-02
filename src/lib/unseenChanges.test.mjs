import test from "node:test";
import assert from "node:assert/strict";
import { changedDayNumbers, clearUnseenDay, markUnseenDays } from "./unseenChanges.ts";

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

// --- changedDayNumbers: which days the background critique actually rewrote --------------------
//
// Moved here from HomeView so it can be tested at all. The two day sets it compares are two
// separate model responses, which is what the fixed-order fingerprint exists for — the previous
// raw `JSON.stringify` compared key order as much as content and its comment claimed, wrongly,
// that both sides "came from the same JSON.parse shape".

const stop = (over = {}) => ({
  name: "Fushimi Inari",
  lat: 34.96,
  lng: 135.77,
  cost: 0,
  why: "w",
  note: "n",
  time: "9:00 AM",
  durationLabel: "2 hours",
  category: "other",
  ...over,
});
const plan = (over = {}) => ({
  date: "2026-05-01",
  weather: "clear",
  summary: "Temples, then the market.",
  stops: [stop()],
  ...over,
});

test("an untouched day set reports nothing changed", () => {
  const days = [plan(), plan({ date: "2026-05-02" })];
  assert.deepEqual(changedDayNumbers(days, days.map((d) => ({ ...d }))), []);
});

test("only the day the critique rewrote is reported, as a 1-based number", () => {
  const before = [plan(), plan({ date: "2026-05-02" }), plan({ date: "2026-05-03" })];
  const after = [
    { ...before[0] },
    { ...before[1], stops: [stop({ name: "Nishiki Market" })] },
    { ...before[2] },
  ];
  assert.deepEqual(changedDayNumbers(before, after), [2]);
});

test("a different key order is not a change", () => {
  // The regression the fixed-order fingerprint exists to prevent: two model responses have no
  // guaranteed key order, and the raw stringify compared it. This dotted every day.
  const before = [{ date: "2026-05-01", weather: "clear", summary: "s", stops: [stop()] }];
  const after = [{ stops: [stop()], summary: "s", weather: "clear", date: "2026-05-01" }];
  assert.deepEqual(changedDayNumbers(before, after), []);
});

test("a server-attached weatherDetail is not a change", () => {
  // Attached from the forecast lookup rather than authored, and rebuilt per run — comparing it
  // would flag every day on every revision.
  const before = [plan({ weatherDetail: { date: "2026-05-01", tempMaxC: 21 } })];
  const after = [plan({ weatherDetail: { date: "2026-05-01", tempMaxC: 22 } })];
  assert.deepEqual(changedDayNumbers(before, after), []);
});

test("a rewritten day narrative IS a change", () => {
  const before = [plan()];
  const after = [plan({ summary: "Rewritten: museums instead." })];
  assert.deepEqual(changedDayNumbers(before, after), [1]);
});

test("a changed lodging or a changed stop time is a change", () => {
  assert.deepEqual(
    changedDayNumbers([plan()], [plan({ lodging: { name: "H", cost: 100, note: "n" } })]),
    [1]
  );
  assert.deepEqual(
    changedDayNumbers([plan()], [plan({ stops: [stop({ time: "11:00 AM" })] })]),
    [1]
  );
});

test("no previous day set means nothing to compare and nothing reported", () => {
  assert.deepEqual(changedDayNumbers(null, [plan()]), []);
});

test("a day the revision added is reported; one it dropped cannot be", () => {
  const before = [plan()];
  assert.deepEqual(changedDayNumbers(before, [plan(), plan({ date: "2026-05-02" })]), [2]);
  assert.deepEqual(changedDayNumbers([plan(), plan({ date: "2026-05-02" })], [plan()]), []);
});
