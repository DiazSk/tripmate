/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/anchorGeocode.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { geocodeAnchors } from "./anchorGeocode.ts";

test("geocodeAnchors fills misses from the batch, then the fuzzy fallback", async () => {
  const anchors = [
    { name: "Known", lat: 1, lng: 2, priority: "must" },
    { name: "Batch hit", lat: null, lng: null, priority: "want" },
    { name: "Fuzzy hit", lat: null, lng: null, priority: "want" },
    { name: "Nowhere", lat: null, lng: null, priority: "want" },
  ];
  const out = await geocodeAnchors(anchors, { lat: 0, lon: 0 }, {
    resolve: async (names) => {
      assert.deepEqual(names, ["Batch hit", "Fuzzy hit", "Nowhere"]);
      return { "Batch hit": { lat: 10, lon: 20 } };
    },
    search: async (name) => (name === "Fuzzy hit" ? { lat: 30, lng: 40 } : null),
  });
  assert.deepEqual(out.map((a) => [a.name, a.lat, a.lng]), [
    ["Known", 1, 2],
    ["Batch hit", 10, 20],
    ["Fuzzy hit", 30, 40],
    ["Nowhere", null, null],
  ]);
});

test("geocodeAnchors never throws when the lookups do", async () => {
  const anchors = [{ name: "X", lat: null, lng: null, priority: "must" }];
  const out = await geocodeAnchors(anchors, { lat: 0, lon: 0 }, {
    resolve: async () => { throw new Error("overpass down"); },
    search: async () => { throw new Error("also down"); },
  });
  assert.deepEqual(out, anchors);
});

test("geocodeAnchors returns within budget when the batch and every fuzzy lookup hang", async () => {
  const hang = () => new Promise(() => {}); // never resolves
  const anchors = [
    { name: "A", lat: null, lng: null, priority: "want" },
    { name: "B", lat: null, lng: null, priority: "want" },
  ];
  const started = Date.now();
  const out = await geocodeAnchors(
    anchors,
    { lat: 0, lon: 0 },
    { resolve: hang, search: hang },
    50 // tiny budget so the test stays fast
  );
  assert.ok(Date.now() - started < 1000, "must not wait for the hung calls");
  assert.deepEqual(out, anchors);
});
