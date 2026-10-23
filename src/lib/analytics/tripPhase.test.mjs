/* Run: node --import ./scripts/test-db.mjs --import ./scripts/ts-resolve.mjs --test src/lib/analytics/tripPhase.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { todayInZone, tripPhase } from "./tripPhase.ts";

test("the day before the start is before", () => {
  assert.equal(tripPhase("2026-09-20", "2026-09-23", "2026-09-19"), "before");
});

test("the start and end days are during, and so is a day between", () => {
  assert.equal(tripPhase("2026-09-20", "2026-09-23", "2026-09-20"), "during");
  assert.equal(tripPhase("2026-09-20", "2026-09-23", "2026-09-21"), "during");
  assert.equal(tripPhase("2026-09-20", "2026-09-23", "2026-09-23"), "during");
});

test("the day after the end is after", () => {
  assert.equal(tripPhase("2026-09-20", "2026-09-23", "2026-09-24"), "after");
});

test("a one-day trip is during on its day only", () => {
  assert.equal(tripPhase("2026-09-20", "2026-09-20", "2026-09-19"), "before");
  assert.equal(tripPhase("2026-09-20", "2026-09-20", "2026-09-20"), "during");
  assert.equal(tripPhase("2026-09-20", "2026-09-20", "2026-09-21"), "after");
});

test("today is read in the trip's own zone, not the viewer's", () => {
  const at = new Date("2026-09-28T20:00:00Z");
  assert.equal(todayInZone("Asia/Tokyo", at), "2026-09-29");
  assert.equal(todayInZone("America/Los_Angeles", at), "2026-09-28");
});

test("an unknown or missing zone falls back to the viewer's day rather than throwing", () => {
  assert.match(todayInZone(null), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(todayInZone("Mars/Olympus_Mons"), /^\d{4}-\d{2}-\d{2}$/);
});
