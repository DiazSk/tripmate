import { test } from "node:test";
import assert from "node:assert/strict";

import { clearsIn, country, city, featured, phase, phaseLine, postmark, rememberedLine } from "./memories.ts";

const today = new Date("2026-10-14T23:30:00Z");
const trip = (destination, startDate, endDate, extra = {}) => ({ id: destination, destination, startDate, endDate, budget: 0, ...extra });

test("a trip reads against today's UTC calendar day", () => {
  assert.equal(phase(trip("A", "2026-10-15", "2026-10-18"), today), "upcoming");
  assert.equal(phaseLine(trip("A", "2026-10-15", "2026-10-18"), today), "Tomorrow");
  assert.equal(phaseLine(trip("A", "2026-11-13", "2026-11-19"), today), "In 30 days");
  assert.equal(phaseLine(trip("A", "2026-10-10", "2026-10-14"), today), "Happening now");
  assert.equal(phaseLine(trip("A", "2026-10-01", "2026-10-13"), today), "Remembered");
});

test("the postmark is the month the trip starts", () => {
  assert.deepEqual(postmark(trip("A", "2025-12-27", "2026-01-02")), { month: "DEC", year: "2025" });
});

test("city and country split on the first comma", () => {
  assert.equal(city(trip("Val d'Orcia, Tuscany, Italy", "", "")), "Val d'Orcia");
  assert.equal(country(trip("Val d'Orcia, Tuscany, Italy", "", "")), "Tuscany, Italy");
  assert.equal(country(trip("Lisbon", "", "")), "");
});

test("a draft counts down from when it was made", () => {
  assert.equal(clearsIn({ createdAt: "2026-10-14T08:00:00.000Z" }, today), "Cleared in 30 days unless you keep it");
  assert.equal(clearsIn({ createdAt: "2026-09-15T08:00:00.000Z" }, today), "Cleared tomorrow unless you keep it");
  assert.equal(clearsIn({}, today), null);
});

test("the hero line runs oldest to newest, and the hero stands on the next trip", () => {
  const trips = [trip("Lisbon, Portugal", "2026-11-13", "2026-11-19"), trip("Sinaia, Romania", "2025-12-27", "2026-01-02"), trip("Engadin, Switzerland", "2026-12-18", "2026-12-23")];
  assert.equal(rememberedLine(trips), "3 trips remembered, from Sinaia to Engadin.");
  assert.equal(rememberedLine([trips[0]]), "1 trip remembered, starting with Lisbon.");
  assert.equal(featured(trips, today)?.destination, "Lisbon, Portugal");
  assert.equal(featured([trips[1]], today)?.destination, "Sinaia, Romania");
  assert.equal(featured([], today), null);
});
