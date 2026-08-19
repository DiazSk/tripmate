/* Run: node --test src/lib/dragDrop.test.mjs
 *
 * Drag ids are the contract between the two drag surfaces and their drop handlers. A malformed id
 * silently parsed as day 0 / stop 0 would move the wrong stop to the wrong day, which is the worst
 * possible failure for a gesture nobody asked to be undoable. */
import assert from "node:assert/strict";
import test from "node:test";
import { dayDropId, dwellVerdict, parseDragId, stopDragId } from "./dragDrop.ts";

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
