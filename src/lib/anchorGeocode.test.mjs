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
    photon: async () => undefined,
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
    photon: async () => { throw new Error("photon down"); },
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
    { resolve: hang, photon: hang, search: hang },
    50 // tiny budget so the test stays fast
  );
  assert.ok(Date.now() - started < 1000, "must not wait for the hung calls");
  assert.deepEqual(out, anchors);
});

test("geocodeAnchors: Photon fills what the batch missed, with its area, before the fuzzy search", async () => {
  const searched = [];
  const anchors = [
    { name: "Marine Drive", lat: null, lng: null, priority: "want" },
    { name: "Leopold Cafe", lat: null, lng: null, priority: "must" },
    { name: "Hidden", lat: null, lng: null, priority: "want" },
  ];
  const out = await geocodeAnchors(anchors, { lat: 19.076, lon: 72.8777 }, {
    resolve: async () => ({}),
    photon: async (name) =>
      name === "Leopold Cafe" ? { lat: 18.9227, lng: 72.8318, area: "Apollo Bandar" }
      : name === "Marine Drive" ? null // the request failed: falls through like a miss
      : undefined,
    search: async (name) => {
      searched.push(name);
      return name === "Marine Drive" ? { lat: 18.9499, lng: 72.8188 } : null;
    },
  });
  assert.deepEqual(searched, ["Marine Drive", "Hidden"], "only Photon's misses reach the fuzzy search");
  assert.deepEqual(out[1], { name: "Leopold Cafe", lat: 18.9227, lng: 72.8318, priority: "must", area: "Apollo Bandar" });
  assert.deepEqual(out[0], { name: "Marine Drive", lat: 18.9499, lng: 72.8188, priority: "want" });
  assert.deepEqual(out[2], anchors[2]);
});

test("geocodeAnchors: a far-away Photon hit is rejected by the real client's radius", async () => {
  const { pickHit } = await import("./photon.ts");
  const near = { lat: 19.076, lon: 72.8777 };
  const anchors = [{ name: "Marine Drive", lat: null, lng: null, priority: "want" }];
  const out = await geocodeAnchors(anchors, near, {
    resolve: async () => ({}),
    // Kochi's Marine Drive, through the same pick the live client uses.
    photon: async (name) => pickHit(name, [{ geometry: { coordinates: [76.2789, 9.9816] }, properties: { name } }], near),
    search: async () => null,
  });
  assert.deepEqual(out, anchors);
});

test("geocodeAnchors: hung Photon lookups still return within budget", async () => {
  const anchors = Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, lat: null, lng: null, priority: "want" }));
  const started = Date.now();
  const out = await geocodeAnchors(
    anchors,
    { lat: 0, lon: 0 },
    { resolve: async () => ({}), photon: () => new Promise(() => {}), search: async () => null },
    60
  );
  assert.ok(Date.now() - started < 1000, "must not wait for the hung Photon calls");
  assert.deepEqual(out, anchors);
});

test("geocodeAnchors: a hung batch leaves Photon the second half of the budget", async () => {
  const anchors = [{ name: "Leopold Cafe", lat: null, lng: null, priority: "want" }];
  const out = await geocodeAnchors(
    anchors,
    { lat: 0, lon: 0 },
    { resolve: () => new Promise(() => {}), photon: async () => ({ lat: 1, lng: 2, area: "Apollo Bandar" }), search: async () => null },
    100
  );
  assert.deepEqual(out[0], { ...anchors[0], lat: 1, lng: 2, area: "Apollo Bandar" });
});

test("geocodeAnchors: never more than three Photon lookups in flight", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const anchors = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, lat: null, lng: null, priority: "want" }));
  await geocodeAnchors(anchors, { lat: 0, lon: 0 }, {
    resolve: async () => ({}),
    photon: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return undefined;
    },
    search: async () => null,
  });
  assert.ok(maxInFlight >= 1 && maxInFlight <= 3, `max in flight was ${maxInFlight}`);
});
