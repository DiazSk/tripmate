import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherEvidence } from "./meriEvidence.ts";
import { parseMeriAnswer } from "./meriAnswer.ts";

const point = { lat: 31.3, lng: 35.4 };
const trip = { title: "Petra", bestMonths: [3, 4, 10] };
const climate = [{ month: 3, highC: 21, rainDays: 3 }, { month: 7, highC: 33, rainDays: 0 }];

function fakes(over = {}) {
  const calls = [];
  const base = { climate: async () => climate, dietPlaces: async () => null, nearby: async () => null, pois: async () => null, venues: async () => null, ...over };
  const deps = Object.fromEntries(Object.entries(base).map(([name, fn]) => [name, async (...args) => { calls.push(name); return fn(...args); }]));
  return { calls, deps };
}

test("best_time with a ready trip uses its months and source, and climate adds facts", async () => {
  const { deps } = fakes();
  const e = await gatherEvidence({ kind: "best_time", point, place: "Petra", diet: null, readyTrip: trip }, deps);
  assert.deepEqual(e.sources.map((s) => [s.id, s.label]), [["trip", "TripMate's ready-made Petra trip"], ["climate", "Open-Meteo weather history"]]);
  // A suggestion, worded so the model cannot read it as the traveller's own booking.
  assert.ok(e.facts.some((f) => f.sourceId === "trip" && f.text === "TripMate's ready-made Petra trip suggests going in March, April, October; it is a suggestion, not the traveller's own trip."));
  // July is a fact but not a good month (33°C): only the trip's months and the climate's mildest may be named.
  assert.deepEqual(e.months, [3, 4, 10]);
  assert.ok(e.facts.some((f) => f.text === "July: 33°C average high, 0 rain days" && f.sourceId === "climate"));
});

test("best_time without a ready trip names only the climate's good months", async () => {
  const hot = [{ month: 3, highC: 22, rainDays: 2 }, { month: 7, highC: 40, rainDays: 0 }, { month: 11, highC: 24, rainDays: 1 }];
  const { deps } = fakes({ climate: async () => hot });
  const e = await gatherEvidence({ kind: "best_time", point, place: "Petra", diet: null, readyTrip: null }, deps);
  assert.deepEqual(e.months, [3, 11]);
  assert.ok(e.facts.some((f) => f.text.startsWith("July: 40°C")));
});

test("an answer naming a 40°C July is not checked, though July's climate is in the evidence", async () => {
  const hot = [{ month: 3, highC: 22, rainDays: 2 }, { month: 7, highC: 40, rainDays: 0 }];
  const { deps } = fakes({ climate: async () => hot });
  const e = await gatherEvidence({ kind: "best_time", point, place: "Petra", diet: null, readyTrip: null }, deps);
  const answer = (months) => parseMeriAnswer(JSON.stringify({ answer: "Go then.", places: [], months, sources: ["climate"], nothing: false }), e);
  assert.equal(answer([7]).nothingChecked, true);
  assert.equal(answer([3]).nothingChecked, false);
});

test("the five outside sources link to their fixed home pages; TripMate's own carry no link", async () => {
  const place = (name, sourceId) => ({ id: "x", name, lat: 1, lng: 2, sourceId });
  const { deps } = fakes({
    dietPlaces: async () => [place("Zad", "osm")],
    venues: async () => [place("Nile", "yelp")],
  });
  const food = await gatherEvidence({ kind: "food", point, place: "Petra", diet: "Halal", readyTrip: null, extraSources: [{ id: "plan", label: "Your plan" }] }, deps);
  assert.deepEqual(food.sources.map((s) => [s.id, s.url]), [["plan", undefined], ["osm", "https://www.openstreetmap.org"], ["yelp", "https://www.yelp.com"]]);
  const best = await gatherEvidence({ kind: "best_time", point, place: "Petra", diet: null, readyTrip: trip }, deps);
  assert.deepEqual(best.sources.map((s) => [s.id, s.url]), [["trip", undefined], ["climate", "https://open-meteo.com"]]);
  const { deps: seeDeps } = fakes({
    nearby: async () => ({ provider: "google", places: [place("Treasury", "google")] }),
    pois: async () => [place("Siq", "opentripmap")],
  });
  const see = await gatherEvidence({ kind: "see", point, place: "Petra", diet: null, readyTrip: null }, seeDeps);
  assert.deepEqual(see.sources.map((s) => [s.id, s.url]), [["google", "https://maps.google.com"], ["opentripmap", "https://opentripmap.io"]]);
});

test("best_time without a ready trip or climate is empty", async () => {
  const { deps } = fakes({ climate: async () => null });
  const e = await gatherEvidence({ kind: "best_time", point, place: "Petra", diet: null, readyTrip: null }, deps);
  assert.deepEqual(e, { sources: [], places: [], months: [], facts: [] });
});

test("food with failing fetchers yields no places and no osm source", async () => {
  const { deps } = fakes({ dietPlaces: async () => { throw new Error("down"); } });
  const e = await gatherEvidence({ kind: "food", point, place: "Petra", diet: "Halal", readyTrip: null }, deps);
  assert.deepEqual(e.places, []);
  assert.ok(!e.sources.some((s) => s.id === "osm"));
});

test("food de-duplicates by name, numbers the places and cites each source once", async () => {
  const place = (name, sourceId) => ({ id: "x", name, lat: 1, lng: 2, sourceId });
  const { deps, calls } = fakes({
    dietPlaces: async () => [place("Al Baik", "osm"), place("Zad", "osm")],
    venues: async () => [place("al baik", "yelp"), place("Nile", "yelp")],
  });
  const e = await gatherEvidence({ kind: "food", point, place: "Petra", diet: "Halal", readyTrip: null }, deps);
  assert.deepEqual(e.places.map((p) => [p.id, p.name, p.sourceId]), [["p1", "Al Baik", "osm"], ["p2", "Zad", "osm"], ["p3", "Nile", "yelp"]]);
  assert.deepEqual(e.sources.map((s) => s.id), ["osm", "yelp"]);
  assert.deepEqual(calls, ["dietPlaces", "venues"]);
});

test("food with no diet never asks Yelp", async () => {
  const { deps, calls } = fakes();
  await gatherEvidence({ kind: "food", point, place: "Petra", diet: null, readyTrip: null }, deps);
  assert.deepEqual(calls, ["dietPlaces"]);
});

test("see tags places with the provider that answered", async () => {
  const { deps } = fakes({ nearby: async () => ({ provider: "google", places: [{ id: "g", name: "Treasury", lat: 1, lng: 2, sourceId: "google" }] }) });
  const e = await gatherEvidence({ kind: "see", point, place: "Petra", diet: null, readyTrip: null }, deps);
  assert.deepEqual(e.sources, [{ id: "google", label: "Google Places", url: "https://maps.google.com" }]);
});

test("entry and other fetch nothing", async () => {
  for (const kind of ["entry", "other"]) {
    const { deps, calls } = fakes();
    const e = await gatherEvidence({ kind, point, place: "Petra", diet: "Halal", readyTrip: trip }, deps);
    assert.deepEqual(e, { sources: [], places: [], months: [], facts: [] });
    assert.deepEqual(calls, []);
  }
});
