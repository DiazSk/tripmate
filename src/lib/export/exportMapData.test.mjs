/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/exportMapData.test.mjs
 *
 * The pure half of the map fetcher: the query it sends and the shapes it reads back. Nothing here
 * touches the network — same boundary exportPhotos.test.mjs draws. Each case is a way Overpass
 * quietly returns the wrong thing rather than an error: a radius query that times out server-side,
 * a multipolygon lake whose geometry hangs off its members, and a hole drawn as an outline. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMapQuery,
  collectExportMap,
  CITY_MODE_MAX_DIAGONAL_KM,
  mapModeFor,
  parseMapContext,
} from "./exportMapData.ts";

const box = { minLat: 47.35, minLng: 8.5, maxLat: 47.4, maxLng: 8.6 };

test("the query asks for a bounding box, never a radius", () => {
  // arrivalPoints.ts measured this: the around: form of a comparable query timed out server-side
  // at 32s and reported it as a 200 with a remark; the box form answered in 18s.
  const query = buildMapQuery(box);
  assert.doesNotMatch(query, /around:/);
  assert.ok(query.includes("47.35,8.5,47.4,8.6"), "south,west,north,east");
});

test("the basemap is one union query, not one request per layer", () => {
  const query = buildMapQuery(box);
  assert.equal(query.split("out geom").length - 1, 1, "exactly one result set");
  assert.match(query, /^\[out:json\]\[timeout:25\];\(/);
});

test("unnamed water is filtered at the query rather than in the parser", () => {
  // Unnamed natural=water at city scale is retention ponds and swimming pools, in the hundreds.
  const query = buildMapQuery(box);
  assert.match(query, /way\["natural"="water"\]\["name"\]/);
  assert.match(query, /relation\["natural"="water"\]\["name"\]/);
});

test("the road grades stop short of residential streets", () => {
  const query = buildMapQuery(box);
  assert.match(query, /motorway\|trunk\|primary\|secondary\|tertiary/);
  assert.doesNotMatch(query, /residential/, "residential multiplies the response for illegible detail");
});

test("elements are split into roads, filled water and stroked water", () => {
  const context = parseMapContext([
    { tags: { highway: "primary" }, geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
    { tags: { natural: "water", name: "Zurichsee" }, geometry: [{ lat: 5, lon: 6 }, { lat: 7, lon: 8 }] },
    { tags: { natural: "coastline" }, geometry: [{ lat: 9, lon: 10 }, { lat: 11, lon: 12 }] },
    { tags: { waterway: "river" }, geometry: [{ lat: 13, lon: 14 }, { lat: 15, lon: 16 }] },
  ]);
  assert.equal(context.roads.length, 1);
  assert.equal(context.waterFill.length, 1, "a lake is a ring to fill");
  assert.equal(context.waterLine.length, 2, "a coastline and a river are lines to stroke");
});

test("lon is renamed to lng on the way in", () => {
  // Overpass says lon; every geometry type in this repo says lng.
  const context = parseMapContext([
    { tags: { highway: "trunk" }, geometry: [{ lat: 47.1, lon: 8.2 }, { lat: 47.2, lon: 8.3 }] },
  ]);
  assert.deepEqual(context.roads[0], [{ lat: 47.1, lng: 8.2 }, { lat: 47.2, lng: 8.3 }]);
});

test("a multipolygon lake is read from its members", () => {
  // A relation answers `out geom` with geometry on its members, not on itself. Reading only
  // el.geometry silently drops exactly the lakes that make a lakeside city recognisable.
  const context = parseMapContext([
    {
      type: "relation",
      tags: { natural: "water", name: "Lake Geneva" },
      members: [
        { role: "outer", geometry: [{ lat: 46.4, lon: 6.5 }, { lat: 46.5, lon: 6.6 }] },
        { role: "outer", geometry: [{ lat: 46.6, lon: 6.7 }, { lat: 46.7, lon: 6.8 }] },
      ],
    },
  ]);
  assert.equal(context.waterFill.length, 2);
});

test("an inner ring is a hole, not an outline", () => {
  const context = parseMapContext([
    {
      type: "relation",
      tags: { natural: "water", name: "Reservoir" },
      members: [
        { role: "outer", geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
        { role: "inner", geometry: [{ lat: 1.4, lon: 1.4 }, { lat: 1.5, lon: 1.5 }] },
      ],
    },
  ]);
  assert.equal(context.waterFill.length, 1, "the island inside the lake is not stroked");
});

test("untagged and irrelevant elements are ignored", () => {
  const context = parseMapContext([
    { geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    { tags: { building: "yes" }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    {},
  ]);
  assert.deepEqual(context, { roads: [], waterFill: [], waterLine: [] });
});

test("a way with fewer than two nodes is not a line", () => {
  const context = parseMapContext([
    { tags: { highway: "primary" }, geometry: [{ lat: 1, lon: 1 }] },
    { tags: { highway: "primary" }, geometry: [] },
    { tags: { highway: "primary" } },
  ]);
  assert.deepEqual(context.roads, []);
});

test("a malformed response yields empty layers instead of throwing", () => {
  assert.deepEqual(parseMapContext([]), { roads: [], waterFill: [], waterLine: [] });
});

test("a walkable city gets streets and a multi-city trip does not", () => {
  assert.equal(mapModeFor({ minLat: 47.35, maxLat: 47.4, minLng: 8.5, maxLng: 8.6 }), "city");
  // Kyoto to Tokyo: a road query over this box returns a prefecture's worth of geometry.
  assert.equal(mapModeFor({ minLat: 34.98, maxLat: 35.68, minLng: 135.75, maxLng: 139.76 }), "region");
  assert.ok(CITY_MODE_MAX_DIAGONAL_KM > 0);
});

/* ---------- numbering, which is what ties a dot to a row in the day list ---------- */

// Region scale on purpose: above CITY_MODE_MAX_DIAGONAL_KM `collectExportMap` makes no Overpass
// call at all, so this exercises the real numbering path with no network and no stubbing.
const farApart = (stops) => ({
  id: "n-" + Math.random(), destination: "X", startDate: "2026-08-20", endDate: "2026-08-20",
  budget: 1000, itinerary: { tier: "comfort", days: [{ date: "2026-08-20", weather: "", stops }] },
});
const at = (lat, lng, over = {}) => ({
  name: "s", lat, lng, cost: 0, note: "", time: "", durationLabel: "", category: "food", ...over,
});

test("dots are numbered from one within their day", async () => {
  const map = await collectExportMap(farApart([at(35.0, 135.7), at(35.6, 139.7), at(34.7, 135.5)]));
  assert.equal(map.mode, "region", "the fixture must not reach the network");
  assert.deepEqual(map.days[0].stops.map((s) => s.n), [1, 2, 3]);
});

test("a stop with no coordinates loses its dot but not its number", async () => {
  // Otherwise every dot after the gap points at the wrong row of the itinerary below it.
  const map = await collectExportMap(farApart([
    at(35.0, 135.7),
    at(undefined, undefined, { name: "no position" }),
    at(35.6, 139.7),
    at(0, 0, { name: "null island" }),
    at(34.7, 135.5),
  ]));
  assert.equal(map.days[0].stops.length, 3, "only the three locatable stops draw");
  assert.deepEqual(map.days[0].stops.map((s) => s.n), [1, 3, 5], "numbers follow the list, not the dots");
});

test("each dot carries the category its colour is drawn from", async () => {
  const map = await collectExportMap(farApart([
    at(35.0, 135.7, { category: "food" }),
    at(35.6, 139.7, { category: "entry" }),
    at(34.7, 135.5, { category: "transit" }),
  ]));
  assert.deepEqual(map.days[0].stops.map((s) => s.category), ["food", "entry", "transit"]);
});

test("an unrecognised or missing category falls to the neutral slot", async () => {
  // Older saved itineraries predate the field, and a model can invent a fifth value.
  const map = await collectExportMap(farApart([
    at(35.0, 135.7, { category: undefined }),
    at(35.6, 139.7, { category: "brunch" }),
  ]));
  assert.deepEqual(map.days[0].stops.map((s) => s.category), ["other", "other"]);
});
