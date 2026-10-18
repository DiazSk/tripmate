/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/actionHolds.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";

const mem = {};
globalThis.sessionStorage = {
  getItem: (k) => mem[k] ?? null,
  setItem: (k, v) => void (mem[k] = v),
};
const { holdAction, heldUntil, secondsLeft, formatWait } = await import("./actionHolds.ts");

test("formatWait", () => {
  assert.equal(formatWait(342), "5:42");
  assert.equal(formatWait(3605), "1:00:05");
  assert.equal(formatWait(59.2), "1:00");
});

test("a hold expires at its time and needs no event to do so", () => {
  holdAction("plan", 10_000);
  assert.equal(heldUntil("plan", 9_999), 10_000);
  assert.equal(secondsLeft("plan", 7_500), 3);
  assert.equal(heldUntil("plan", 10_000), null);
  assert.equal(secondsLeft("plan", 10_001), null);
});

test("a later hold replaces an earlier one; buckets are independent", () => {
  holdAction("edit", 5_000);
  holdAction("edit", 9_000);
  assert.equal(heldUntil("edit", 1), 9_000);
  assert.equal(heldUntil("story", 1), null);
});

test("holds survive a module reload through storage", async () => {
  holdAction("import", 123_456_789_000_000);
  const again = await import("./actionHolds.ts?reload");
  assert.equal(again.heldUntil("import", 1), 123_456_789_000_000);
  assert.equal(again.heldUntil("story", 1), null);
});

test("a reload prunes expired holds and unknown buckets", async () => {
  mem.tripmateHolds = JSON.stringify({ plan: 1, bogus: 123_456_789_000_000, story: 123_456_789_000_000 });
  const again = await import("./actionHolds.ts?prune");
  assert.equal(again.heldUntil("plan", 0), null);
  assert.equal(again.heldUntil("story", 0), 123_456_789_000_000);
  assert.equal(again.heldUntil("bogus", 0), null);
});
