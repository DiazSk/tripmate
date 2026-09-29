import test from "node:test";
import assert from "node:assert/strict";

import { spendSplit, tripSpend } from "./itinerary.ts";

const stop = (cost, over = {}) => ({
  name: "s", lat: 1, lng: 1, cost, note: "", time: "9:00 AM",
  durationLabel: "1 hour", category: "other", ...over,
});
const day = (stops, lodging) => ({ date: "2026-10-22", weather: "", stops, lodging });

test("with nothing entered, every penny is the planner's estimate", () => {
  const s = spendSplit([day([stop(20), stop(30)])]);
  assert.deepEqual(
    { settled: s.settled, projected: s.projected, total: s.total },
    { settled: 0, projected: 50, total: 50 }
  );
});

test("an entered figure moves from projected to settled, and the total does not move", () => {
  const days = [day([stop(20, { actualCost: 25 }), stop(30)])];
  const s = spendSplit(days);
  assert.equal(s.settled, 25);
  assert.equal(s.projected, 30);
  assert.equal(s.total, 55);
  // The one invariant that matters: this may relabel money, never change it.
  assert.equal(s.total, tripSpend(days));
});

test("booked and spent are counted apart", () => {
  const s = spendSplit([
    day([stop(20, { actualCost: 25, costState: "booked" }), stop(40, { actualCost: 35, costState: "spent" })]),
  ]);
  assert.equal(s.booked, 25);
  assert.equal(s.spent, 35);
  assert.equal(s.settled, 60);
});

/**
 * Every figure the web client has ever written carries no `costState`. Counting it as booked or
 * as spent would invent a fact about somebody's money.
 */
test("a real figure of unstated kind is settled and neither", () => {
  const s = spendSplit([day([stop(20, { actualCost: 25 })])]);
  assert.equal(s.settled, 25);
  assert.equal(s.booked, 0);
  assert.equal(s.spent, 0);
});

test("lodging is money too, and can be booked", () => {
  const s = spendSplit([day([], { name: "h", cost: 130, note: "", actualCost: 120, costState: "booked" })]);
  assert.equal(s.settled, 120);
  assert.equal(s.booked, 120);
  assert.equal(s.total, 120);
});

test("the split always reconciles with the figure the bar already draws", () => {
  const days = [
    day([stop(20, { actualCost: 25, costState: "spent" }), stop(30)], { name: "h", cost: 100, note: "" }),
    day([stop(15, { actualCost: 0, costState: "spent" })]),
  ];
  const s = spendSplit(days);
  assert.equal(s.settled + s.projected, s.total);
  assert.equal(s.total, tripSpend(days));
  // A corrected cost of zero is a real answer — it was free — not an absent one.
  assert.equal(s.projected, 130);
});
