import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherEvidence } from "./meriEvidence.ts";

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
  assert.deepEqual(e.sources.map((s) => [s.id, s.label]), [["trip", "Our Petra trip"], ["climate", "Open-Meteo weather history"]]);
  assert.deepEqual(e.months, [3, 4, 7, 10]);
  assert.ok(e.facts.some((f) => f.text === "July: 33°C average high, 0 rain days" && f.sourceId === "climate"));
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
  assert.deepEqual(e.sources, [{ id: "google", label: "Google Places" }]);
});

test("entry and other fetch nothing", async () => {
  for (const kind of ["entry", "other"]) {
    const { deps, calls } = fakes();
    const e = await gatherEvidence({ kind, point, place: "Petra", diet: "Halal", readyTrip: trip }, deps);
    assert.deepEqual(e, { sources: [], places: [], months: [], facts: [] });
    assert.deepEqual(calls, []);
  }
});
