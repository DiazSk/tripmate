/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/heldEvents.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createHeld } from "./heldEvents.ts";

const clock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms) => (t += ms) };
};

test("with no answer an event is held, and a stored Yes within 10s releases it", () => {
  const c = clock();
  const q = createHeld({ now: c.now });
  q.hold("a", true);
  c.advance(9_999);
  assert.deepEqual(q.take(), ["a"]);
  assert.deepEqual(q.take(), []);
});

test("an event older than 10s is dropped when the stored Yes arrives", () => {
  const c = clock();
  const q = createHeld({ now: c.now });
  q.hold("a", true);
  c.advance(10_000);
  assert.deepEqual(q.take(), []);
});

test("after a No (withdrawn) nothing is held, so a later Yes has nothing from before it", () => {
  const q = createHeld();
  q.hold("a", false);
  assert.deepEqual(q.take(), []);
});

test("a Yes tapped clears what was held first", () => {
  const q = createHeld();
  q.hold("a", true);
  q.clear();
  assert.deepEqual(q.take(), []);
});

test("stale entries are pruned at push, and the cap holds", () => {
  const c = clock();
  const q = createHeld({ now: c.now, cap: 2 });
  q.hold("old", true);
  c.advance(11_000);
  q.hold("b", true);
  q.hold("c", true);
  q.hold("d", true);
  assert.deepEqual(q.take(), ["b", "c"]);
});
