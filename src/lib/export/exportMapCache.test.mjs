/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/export/exportMapCache.test.mjs
 *
 * The geometry cache, which exists because of a real failure: a session of testing was enough for
 * all three public Overpass mirrors to refuse this IP, and the exports that went out in that
 * window carried a map with nothing behind the pins. The in-process memo could not help — it dies
 * with the dev server and expires in ten minutes.
 *
 * Unlike its siblings this file does open a database, so it points DB_PATH at a scratch file and
 * imports dynamically afterwards — `db.ts` reads that variable at import time, and a static import
 * is hoisted above any assignment. `fetch` is stubbed throughout; nothing here touches a network. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "tripmate-mapcache-")), "t.db");
const { collectExportMap, boxKey } = await import("./exportMapData.ts");
process.on("exit", () => rmSync(path.dirname(process.env.DB_PATH), { recursive: true, force: true }));

const stop = (lat, lng, over = {}) => ({
  name: "s", lat, lng, cost: 0, note: "", time: "", durationLabel: "", category: "food", ...over,
});
let n = 0;
const cityTrip = () => ({
  id: "cache-" + ++n, destination: "Lisbon", startDate: "2026-08-20", endDate: "2026-08-20",
  budget: 1000,
  itinerary: { tier: "comfort", days: [{ date: "2026-08-20", weather: "", stops: [
    stop(38.7128, -9.1300), stop(38.7100, -9.1390, { category: "entry" }),
  ] }] },
});

const way = (tags, pts) => ({ tags, geometry: pts.map(([lat, lon]) => ({ lat, lon })) });
const geometry = { elements: [
  way({ highway: "primary" },   [[38.705, -9.145], [38.712, -9.136], [38.718, -9.128]]),
  way({ highway: "secondary" }, [[38.708, -9.150], [38.715, -9.131]]),
] };

let calls = 0;
const serving = (body) => { globalThis.fetch = () => { calls++; return Promise.resolve(
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })); }; };
const refusing = () => { globalThis.fetch = () => { calls++; return Promise.reject(new Error("ECONNREFUSED")); }; };

test("the cache key is the rounded frame, so one city serves many trips", () => {
  const a = boxKey({ minLat: 38.70912, minLng: -9.14098, maxLat: 38.71401, maxLng: -9.12811 });
  const b = boxKey({ minLat: 38.70915, minLng: -9.14103, maxLat: 38.71399, maxLng: -9.12809 });
  assert.equal(a, b, "coordinates a hundred metres apart share a row");
  assert.equal(a, "38.709,-9.141,38.714,-9.128");
});

test("a cold export fetches the basemap and keeps it", async () => {
  calls = 0; serving(geometry);
  const map = await collectExportMap(cityTrip());
  assert.equal(map.basemap, true);
  assert.ok(map.roads.length > 0, "roads reached the artifact");
  assert.equal(calls, 1, "one mirror answered, so no others were asked");
});

test("a later export survives every mirror refusing at once", async () => {
  // The exact failure this cache exists for: with it warm, Overpass being down costs nothing.
  calls = 0; serving(geometry);
  const warm = await collectExportMap(cityTrip());
  calls = 0; refusing();
  const cold = await collectExportMap(cityTrip());
  assert.equal(calls, 0, "a cached frame must not be re-asked");
  assert.equal(cold.basemap, true);
  assert.equal(cold.roads, warm.roads, "and it is the same geometry, not a degraded copy");
});

test("with nothing cached and Overpass down, the route still ships and says so", async () => {
  process.env.DB_PATH_UNUSED = "1";
  calls = 0; refusing();
  // A frame far from the one already cached, so this is genuinely a cold miss.
  const trip = cityTrip();
  trip.itinerary.days[0].stops = [stop(41.3851, 2.1734), stop(41.3900, 2.1800, { category: "entry" })];
  const map = await collectExportMap(trip);
  assert.equal(map.basemap, false, "the document must not claim a basemap it does not have");
  assert.equal(map.roads, "");
  assert.equal(map.days[0].stops.length, 2, "the stops are still placed");
  assert.ok(map.days[0].d, "and the route between them still drawn");
  assert.equal(calls, 4, "every mirror was tried before giving up");
});

test("an answer with no geometry is never cached as a blank city", async () => {
  // An empty `elements` with no `remark` is a *successful* answer — "this box has no major roads"
  // — so under the house null-vs-empty convention it does not fall through to the next mirror,
  // and only one is asked. But it must still not be stored: a rural frame would re-ask (rare and
  // cheap), while an instance answering thinly would otherwise blank that city permanently.
  const amsterdam = () => {
    const t = cityTrip();
    t.itinerary.days[0].stops = [stop(52.3676, 4.9041), stop(52.3700, 4.9100, { category: "entry" })];
    return t;
  };

  calls = 0; serving({ elements: [] });
  const first = await collectExportMap(amsterdam());
  assert.equal(first.basemap, false);
  assert.equal(calls, 1, "an empty answer is an answer, not a reason to try the next mirror");

  // Same frame again: it must be re-asked, not served an empty row.
  calls = 0; serving(geometry);
  const second = await collectExportMap(amsterdam());
  assert.ok(calls > 0, "the empty answer must not have been cached");
  assert.equal(second.basemap, true, "and the retry gets a real basemap");
});
