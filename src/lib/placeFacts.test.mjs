/* Run: node --test src/lib/placeFacts.test.mjs
 *
 * OSM's `opening_hours` only ever says which days a place is CLOSED, never a clock-time range,
 * so `mapClosedDaysToHoursByDay` is the whole distiller worth pinning here — `fetchPlaceFacts`
 * itself needs a mocked `fetch` and isn't unit-tested, matching this repo's convention of testing
 * only the pure distiller. */
import assert from "node:assert/strict";
import test from "node:test";
import { mapClosedDaysToHoursByDay } from "./placeFacts.ts";

test("maps OSM closed-day codes to a hoursByDay map of 'Closed' entries", () => {
  assert.deepEqual(mapClosedDaysToHoursByDay(["Tu"]), { tuesday: "Closed" });
  assert.deepEqual(mapClosedDaysToHoursByDay(["Sa", "Su"]), { saturday: "Closed", sunday: "Closed" });
});

test("never fabricates an entry for a day it doesn't know is closed", () => {
  const out = mapClosedDaysToHoursByDay(["Mo"]);
  assert.equal(out.tuesday, undefined);
  assert.equal(Object.keys(out).length, 1);
});

test("returns null for a failed/unmatched lookup, distinct from an empty closed list", () => {
  assert.equal(mapClosedDaysToHoursByDay(null), null);
});

test("returns null for a 24/7 place — nothing is closed, so there is nothing to report", () => {
  assert.equal(mapClosedDaysToHoursByDay([]), null);
});
