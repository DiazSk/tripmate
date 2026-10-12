/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/paperPrint.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { guillochePaths, speckles } from "./paperPrint.ts";

test("the guilloché is a few long, finite paths inside the card", () => {
  const paths = guillochePaths(480, 330);
  assert.ok(paths.length >= 3);
  for (const d of paths) {
    assert.match(d, /^M/);
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    assert.ok(nums.every(Number.isFinite));
  }
});

test("speckles are deterministic per seed and stay inside 0–1", () => {
  assert.deepEqual(speckles(7, 40), speckles(7, 40));
  assert.notDeepEqual(speckles(7, 40), speckles(8, 40));
  for (const s of speckles(3, 60)) assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1 && s.r > 0);
});

test("the rosette closes after 10 turns, so the card's path data stays small", () => {
  const total = guillochePaths(480, 330).reduce((n, d) => n + d.length, 0);
  assert.ok(total < 80_000, `path data is ${total} characters`);
});
