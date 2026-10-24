import test from "node:test";
import assert from "node:assert/strict";
import { addDays, ideaToPrefill, LEAD_DAYS, readyTripToPrefill } from "./homeIdeas.ts";

const none = { destination: null, kind: null, days: null, budget: null, budgetBasis: null, adults: null, children: null, pace: null, interests: [], tags: [], avoidTags: [] };

const trip = {
  slug: "x", title: "X", destination: "Petra, Jordan", country: "", region: "", monument: "", days: 3, priceFrom: 1000,
  priceNote: "", pace: "Slow", tags: [], weekend: false, bestMonths: [], summary: "", featured: false, order: 1,
  itinerary: [
    { key: "d1", day: 1, theme: "", stops: [{ key: "a", name: "A", kind: "", note: "" }, { key: "b", name: "B", kind: "", note: "" }] },
    { key: "d2", day: 2, theme: "", stops: [{ key: "c", name: "C", kind: "", note: "" }] },
  ],
};

test("ideaToPrefill: a length with no date starts 30 days out", () => {
  const p = ideaToPrefill({ ...none, destination: "Lisbon, Portugal", days: 4 }, "2026-10-23");
  assert.equal(p.destination, "Lisbon, Portugal");
  assert.equal(p.startDate, "2026-11-22");
  assert.equal(p.endDate, "2026-11-25");
});

test("ideaToPrefill: only what the sentence said", () => {
  const p = ideaToPrefill({ ...none, kind: "somewhere warm", days: null }, "2026-10-23");
  assert.equal(p.destination, "");
  assert.equal(p.startDate, "");
  assert.equal(p.endDate, "");
  for (const k of ["budgetUsd", "adults", "children", "pace", "interests", "budgetBasis"]) assert.equal(k in p, false, k);
});

test("ideaToPrefill: budget, basis, party, pace, interests carried", () => {
  const p = ideaToPrefill(
    { ...none, budget: 2000, budgetBasis: "per_person", adults: 2, children: 0, pace: "relaxed", interests: ["Food"] },
    "2026-10-23",
  );
  assert.equal(p.budgetUsd, 2000);
  assert.equal(p.budgetBasis, "per_person");
  assert.equal(p.adults, 2);
  assert.equal(p.children, 0);
  assert.equal(p.pace, "relaxed");
  assert.deepEqual(p.interests, ["Food"]);
});

test("readyTripToPrefill: the trip gives place, length, pace and stops; the reading gives party and budget", () => {
  const p = readyTripToPrefill(trip, { ...none, adults: 2, budget: null }, "2026-10-23");
  assert.equal(p.destination, trip.destination);
  assert.equal(p.pace, "relaxed");
  assert.equal(p.mustInclude, "A, B, C");
  assert.equal(p.startDate, "2026-11-22");
  assert.equal(p.endDate, "2026-11-24");
  assert.equal(p.adults, 2);
  assert.equal("budgetUsd" in p, false);
  assert.equal("budgetBasis" in p, false);
});

test("readyTripToPrefill: the reading's budget, basis and party ride along", () => {
  const p = readyTripToPrefill(trip, { ...none, budget: 2000, budgetBasis: "per_person", adults: 2 }, "2026-10-23");
  assert.equal(p.budgetUsd, 2000);
  assert.equal(p.budgetBasis, "per_person");
  assert.equal(p.adults, 2);
});

test("readyTripToPrefill: no reading", () => {
  const p = readyTripToPrefill(trip, null, "2026-10-23");
  assert.deepEqual(Object.keys(p).sort(), ["destination", "endDate", "mustInclude", "pace", "startDate"]);
});

test("ideaToPrefill: clears a previous attempt's must-sees, since a sentence never names stops", () => {
  assert.equal(ideaToPrefill({ ...none, destination: "Lisbon, Portugal" }, "2026-10-23").mustInclude, "");
});

test("a budget without a basis is the whole party's, so an earlier per-person basis cannot linger", () => {
  assert.equal(ideaToPrefill({ ...none, budget: 3000 }, "2026-10-23").budgetBasis, "whole_party");
  assert.equal(readyTripToPrefill(trip, { ...none, budget: 3000 }, "2026-10-23").budgetBasis, "whole_party");
});

test("addDays and LEAD_DAYS: the one date rule both clients share", () => {
  assert.equal(LEAD_DAYS, 30);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-08", 0), "2026-03-08");
});
