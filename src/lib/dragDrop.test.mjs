/* Run: node --test src/lib/dragDrop.test.mjs
 *
 * Drag ids are the contract between the two drag surfaces and their drop handlers. A malformed id
 * silently parsed as day 0 / stop 0 would move the wrong stop to the wrong day, which is the worst
 * possible failure for a gesture nobody asked to be undoable. */
import assert from "node:assert/strict";
import test from "node:test";
import { dayDropId, dropCollision, dwellVerdict, parseDragId, stopAnnouncements, stopDragId } from "./dragDrop.ts";

test("stop and day ids round-trip through parseDragId", () => {
  assert.deepEqual(parseDragId(stopDragId(2, 5)), { kind: "stop", dayIndex: 2, stopIndex: 5 });
  assert.deepEqual(parseDragId(dayDropId(3)), { kind: "day", dayIndex: 3 });
  // Day 0 / stop 0 must survive, since 0 is the falsy trap in this shape of code.
  assert.deepEqual(parseDragId(stopDragId(0, 0)), { kind: "stop", dayIndex: 0, stopIndex: 0 });
  assert.deepEqual(parseDragId(dayDropId(0)), { kind: "day", dayIndex: 0 });
});

test("parseDragId rejects anything it cannot trust rather than guessing", () => {
  for (const bad of [null, undefined, "", "stop", "stop:1", "day", "day:x", "stop:1:x", "stop:1:2:3", "other:1", "day:1:2"]) {
    assert.equal(parseDragId(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("dwellVerdict starts a countdown only when it should", () => {
  const base = { pending: null, msSinceLastSwitch: 10_000, cooldownMs: 900 };

  // Nothing under the pointer: stand down.
  assert.equal(dwellVerdict({ ...base, requested: null }), "clear");

  // A fresh day, long after any switch: go.
  assert.equal(dwellVerdict({ ...base, requested: 2 }), "start");

  // Day 0 must behave like any other day — the falsy trap.
  assert.equal(dwellVerdict({ ...base, requested: 0 }), "start");

  // Already counting down on this day: leaving it alone is what lets it elapse.
  assert.equal(dwellVerdict({ ...base, requested: 2, pending: 2 }), "ignore");

  // A different day while one is pending is allowed to take over.
  assert.equal(dwellVerdict({ ...base, requested: 3, pending: 2 }), "start");
});

test("dwellVerdict refuses to switch again inside the cooldown", () => {
  // This is the anti-oscillation rule: right after a switch, a day under a stationary pointer
  // must not start another countdown, or the view ping-pongs.
  assert.equal(
    dwellVerdict({ requested: 1, pending: null, msSinceLastSwitch: 0, cooldownMs: 900 }),
    "ignore"
  );
  assert.equal(
    dwellVerdict({ requested: 1, pending: null, msSinceLastSwitch: 899, cooldownMs: 900 }),
    "ignore"
  );
  // Once it has elapsed, a deliberate second hop is honoured.
  assert.equal(
    dwellVerdict({ requested: 1, pending: null, msSinceLastSwitch: 900, cooldownMs: 900 }),
    "start"
  );
  // "Not over a day" still wins over the cooldown — clearing is never harmful.
  assert.equal(
    dwellVerdict({ requested: null, pending: 1, msSinceLastSwitch: 0, cooldownMs: 900 }),
    "clear"
  );
});

const rect = (top, height, left = 0, width = 300) => ({
  top, left, width, height, bottom: top + height, right: left + width,
});

/** Day 0's list as the editor lays it out: three rows (a short one stepping onto a tall one) inside
 *  the day's own drop target, which is the whole list. */
function editorList() {
  const rows = [rect(0, 40), rect(48, 100), rect(156, 80)];
  const ids = [stopDragId(0, 0), stopDragId(0, 1), stopDragId(0, 2), dayDropId(0)];
  const droppableRects = new Map([...rows.map((r, i) => [ids[i], r]), [dayDropId(0), rect(0, 236)]]);
  // The list registered first: what happens after any stop is added, since its id is newer.
  const droppableContainers = [dayDropId(0), ...ids.slice(0, 3)].map((id) => ({ id }));
  return { droppableRects, droppableContainers };
}

test("a keyboard step lands on the row it stepped to, not on the day's list", () => {
  // sortableKeyboardCoordinates moves row 0 (40px) onto row 1's bottom edge. By centres the list
  // (centre 118) is nearer than row 1 (centre 98) to the moved rect (centre 128), so the drop
  // resolved to the day it started in and nothing moved.
  const [hit] = dropCollision({
    active: { id: stopDragId(0, 0) },
    collisionRect: rect(108, 40),
    pointerCoordinates: null,
    ...editorList(),
  });
  assert.equal(hit.id, stopDragId(0, 1));
});

test("with a pointer, whatever is under it still wins", () => {
  const [hit] = dropCollision({
    active: { id: stopDragId(0, 0) },
    collisionRect: rect(108, 40),
    pointerCoordinates: { x: 10, y: 200 },
    ...editorList(),
  });
  // Row 2 and the list both contain the point; the smaller target is the one meant.
  assert.equal(hit.id, stopDragId(0, 2));
});

test("the live region speaks names and positions, never ids", () => {
  const days = [
    { date: "2026-09-19", weather: "", stops: [{ name: "Duomo" }, { name: "Uffizi" }, { name: "Ponte Vecchio" }] },
    { date: "2026-09-20", weather: "", stops: [{ name: "Siena" }] },
  ];
  const say = stopAnnouncements(days);
  const active = { id: stopDragId(0, 0) };
  const over = (id) => ({ id });
  const all = [
    say.onDragStart({ active }),
    say.onDragOver({ active, over: over(stopDragId(0, 2)) }),
    say.onDragOver({ active, over: over(stopDragId(1, 0)) }),
    say.onDragOver({ active, over: over(dayDropId(1)) }),
    say.onDragEnd({ active, over: over(stopDragId(0, 2)) }),
    say.onDragEnd({ active, over: over(dayDropId(0)) }),
    say.onDragCancel({ active, over: null }),
  ];
  assert.deepEqual(all, [
    "Picked up “Duomo”.",
    "Moved to position 3 of 3.",
    "Moved to position 1 of 2 on day 2.",
    "Over day 2. Drop to move it there.",
    "Dropped at position 3.",
    "Dropped. Nothing moved.",
    "Cancelled. Duomo is back where it was.",
  ]);
  for (const line of all) assert.doesNotMatch(line, /stop:|day:/);
});
