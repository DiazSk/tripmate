/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/stopChanges.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { stopChanges } from "./stopChanges.ts";

const it = (...days) => ({ tier: "mid", days: days.map((names) => ({ date: "2026-01-01", weather: "", stops: names.map((name) => ({ name })) })) });

test("identical itineraries change nothing", () => {
  assert.deepEqual(stopChanges(it(["A", "B"], ["C"]), it(["A", "B"], ["C"])), []);
});

test("a renamed stop at the same slot is a swap", () => {
  assert.deepEqual(stopChanges(it(["A", "B", "C"]), it(["A", "X", "C"])), [{ change: "swap", count: 1 }]);
});

test("a dropped stop is a remove", () => {
  assert.deepEqual(stopChanges(it(["A", "B", "C"]), it(["A", "C"])), [{ change: "remove", count: 1 }]);
});

test("an extra stop is an add", () => {
  assert.deepEqual(stopChanges(it(["A", "C"]), it(["A", "B", "C"])), [{ change: "add", count: 1 }]);
});

test("the same stops in a new order are a move", () => {
  assert.deepEqual(stopChanges(it(["A", "B", "C"]), it(["B", "C", "A"])), [{ change: "move", count: 1 }]);
});

test("days are judged independently and counts add up per kind", () => {
  const before = it(["A", "B"], ["C", "D"], ["E"]);
  const after = it(["A", "X"], ["C", "D", "F"], ["E", "G"]);
  assert.deepEqual(stopChanges(before, after), [
    { change: "swap", count: 1 },
    { change: "add", count: 2 },
  ]);
});

test("a stop moved between days is a remove on one and an add on the other", () => {
  assert.deepEqual(stopChanges(it(["A", "B"], ["C"]), it(["A"], ["C", "B"])), [
    { change: "remove", count: 1 },
    { change: "add", count: 1 },
  ]);
});

test("names compare ignoring case and surrounding space", () => {
  assert.deepEqual(stopChanges(it(["Duomo"]), it([" duomo "])), []);
});

test("a whole day added or dropped counts its stops", () => {
  assert.deepEqual(stopChanges(it(["A"]), it(["A"], ["B", "C"])), [{ change: "add", count: 2 }]);
  assert.deepEqual(stopChanges(it(["A"], ["B", "C"]), it(["A"])), [{ change: "remove", count: 2 }]);
});
