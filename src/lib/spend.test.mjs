import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDays, setStayActual, stayActual, stayNights, surenessFields, surenessOf, surenessSplit, tripSpend } from "./itinerary.ts";

const stop = (cost, over = {}) => ({
  name: "s", lat: 1, lng: 1, cost, note: "", time: "9:00 AM",
  durationLabel: "1 hour", category: "other", ...over,
});
const day = (stops, lodging) => ({ date: "2026-10-22", weather: "", stops, lodging });

test("with nothing entered, every penny is the planner's estimate", () => {
  assert.deepEqual(surenessSplit([day([stop(20), stop(30)])]), { estimate: 50, booked: 0, paid: 0 });
});

test("booked and locked read as one: a fixed stop is booked before any figure is entered", () => {
  assert.equal(surenessOf(stop(100)), "estimate");
  assert.equal(surenessOf(stop(12, { timeFlexibility: "FIXED" })), "booked");
  assert.equal(surenessOf(stop(30, { costState: "spent" })), "paid");
  assert.equal(surenessOf(stop(30, { costState: "booked", actualCost: 28 })), "booked");
});

/** The web's fields ask what was actually paid and never wrote a kind; the phone read those as estimates. */
test("a figure entered with no kind is paid, on both clients", () => {
  assert.equal(surenessOf(stop(20, { actualCost: 25 })), "paid");
  assert.equal(surenessOf({ name: "h", cost: 130, note: "", actualCost: 120 }), "paid");
  assert.deepEqual(surenessSplit([day([stop(20, { actualCost: 25 })])]), { estimate: 0, booked: 0, paid: 25 });
});

test("choosing a sureness writes the lock with it, and an estimate releases it", () => {
  assert.deepEqual(surenessFields("booked"), { costState: "booked", timeFlexibility: "FIXED" });
  assert.deepEqual(surenessFields("paid"), { costState: "spent", timeFlexibility: "FIXED" });
  assert.deepEqual(surenessFields("estimate"), { costState: undefined, timeFlexibility: "PREFERRED" });
});

test("the split always reconciles with the figure the bar already draws", () => {
  const days = [
    day([stop(20, { actualCost: 25, costState: "spent" }), stop(30)], { name: "h", cost: 100, note: "", costState: "booked" }),
    day([stop(15, { actualCost: 0 })]),
  ];
  const s = surenessSplit(days);
  assert.deepEqual(s, { estimate: 30, booked: 100, paid: 25 });
  // A corrected cost of zero is a real answer — it was free — not an absent one.
  assert.equal(s.estimate + s.booked + s.paid, tripSpend(days));
});

const nightAt = (name, cost = 150) => ({ name, cost, note: "" });
const fourDays = () => [
  day([], nightAt("Casa")), day([], nightAt("Casa")), day([], nightAt("Casa")), day([]),
];

test("a stay is the run of nights at the same place, and the departure day is not one", () => {
  const days = [day([], nightAt("Casa")), day([], nightAt(" casa ")), day([], nightAt("Hotel B")), day([])];
  assert.deepEqual(stayNights(days, 1), [0, 1]);
  assert.deepEqual(stayNights(days, 2), [2]);
  assert.deepEqual(stayNights(days, 3), []);
});

test("a whole-stay figure is spread across its nights, so the trip counts it once", () => {
  const days = fourDays();
  setStayActual(days, 0, 600);
  assert.deepEqual(days.slice(0, 3).map((d) => d.lodging.actualCost), [200, 200, 200]);
  assert.equal(tripSpend(days), 600);
  assert.equal(stayActual(days, 2), 600);
});

test("the shares add back to the cent, and clearing restores every estimate", () => {
  const days = fourDays();
  setStayActual(days, 1, 100);
  assert.deepEqual(days.slice(0, 3).map((d) => d.lodging.actualCost), [33.34, 33.33, 33.33]);
  assert.equal(stayActual(days, 0), 100);
  setStayActual(days, 1, undefined);
  assert.equal(stayActual(days, 0), undefined);
  assert.equal(tripSpend(days), 450);
});

test("a $0 'No lodging' entry is the model saying there is no stay, so it is not one", () => {
  const [stay, placeholder, priced] = normalizeDays([
    day([], nightAt("Nomad hostel in Old Town")),
    day([], nightAt("No lodging (departure day)", 0)),
    day([], nightAt("No lodging", 40)),
  ]);
  assert.equal(stay.lodging.name, "Nomad hostel in Old Town");
  assert.equal(placeholder.lodging, undefined);
  assert.equal(priced.lodging.cost, 40, "a priced entry is a stay, whatever it is called");
});
