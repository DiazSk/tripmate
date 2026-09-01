/* Run: node --test src/lib/placeFacts.test.mjs
 *
 * OSM's `opening_hours` only ever says which days a place is CLOSED, never a clock-time range,
 * so `mapClosedDaysToHoursByDay` is the whole distiller worth pinning here. The batched
 * `fetchPoiOsmTags` network call now lives in generationRunner.ts (one call per generation run,
 * not per stop); `buildPlaceFacts` is the pure per-stop distiller left in this module, so it's
 * tested directly instead of needing a mocked `fetch`. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceFacts, mapClosedDaysToHoursByDay } from "./placeFacts.ts";

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

test("buildPlaceFacts returns null when the name had no OSM match", () => {
  assert.equal(buildPlaceFacts(undefined), null);
});

test("buildPlaceFacts returns null when the matched tags have no usable closed-day data", () => {
  assert.equal(buildPlaceFacts({ openingHours: null, lat: null, lon: null, wheelchair: null }), null);
});

test("buildPlaceFacts fills hoursByDay from a matched place's opening_hours, leaving the other permanently-dead fields at their fixed values", () => {
  const facts = buildPlaceFacts({ openingHours: "Tu-Su 10:00-18:00", lat: 1, lon: 2, wheelchair: "yes" });
  assert.deepEqual(facts.hoursByDay, { monday: "Closed" });
  assert.equal(facts.admissionUsd, null);
  assert.equal(facts.title, null);
  assert.equal(facts.bookAhead, false);
});
