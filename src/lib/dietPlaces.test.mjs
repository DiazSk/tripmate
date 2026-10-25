import { test } from "node:test";
import assert from "node:assert/strict";
import { dietPlacesQuery, distilDietPlaces } from "./dietPlaces.ts";

const point = { lat: 36.1, lng: -115.2 };

test("a stated diet filters on its OSM diet tag", () => {
  const q = dietPlacesQuery(point, "Halal", 2000);
  assert.match(q, /diet:halal/);
  assert.match(q, /around:2000/);
  assert.match(q, /amenity"~"restaurant\|cafe\|fast_food"/);
});

test("a hyphenated diet becomes OSM's underscore spelling", () => {
  assert.match(dietPlacesQuery(point, "Gluten-free", 2000), /diet:gluten_free/);
});

test("no diet asks for places with a cuisine and nothing else", () => {
  const q = dietPlacesQuery(point, null, 2000);
  assert.match(q, /\["cuisine"\]/);
  assert.doesNotMatch(q, /diet:/);
});

test("distil drops unnamed elements, reads a way's centre, names the cuisine and caps", () => {
  const els = [
    { type: "node", id: 1, lat: 1, lon: 2, tags: { name: "Node Grill", cuisine: "lebanese;grill" } },
    { type: "way", id: 2, center: { lat: 3, lon: 4 }, tags: { name: "Way Cafe" } },
    { type: "node", id: 3, lat: 5, lon: 6, tags: { cuisine: "thai" } },
    ...Array.from({ length: 12 }, (_, i) => ({ type: "node", id: 100 + i, lat: i, lon: i, tags: { name: `Extra ${i}` } })),
  ];
  const out = distilDietPlaces(els, "Halal");
  assert.equal(out.length, 8);
  assert.deepEqual([out[0].name, out[0].lat, out[0].lng, out[0].detail], ["Node Grill", 1, 2, "lebanese, grill"]);
  assert.deepEqual([out[1].name, out[1].lat, out[1].lng, out[1].detail], ["Way Cafe", 3, 4, undefined]);
  assert.ok(out.every((p) => p.sourceId === "osm" && p.name));
});
