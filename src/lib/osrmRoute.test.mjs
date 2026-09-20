/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/osrmRoute.test.mjs
 *
 * `osrmRoute.ts` reaches `fetchCache.ts` and therefore `libsql`, so this file sets
 * `DB_PATH` to a scratch file and imports dynamically — the `fetchCache.test.mjs` pattern.
 *
 * Only the pure core is covered, and the split in the module exists to make that possible:
 * `fetchRoute` is `cached()` plus `fetch`, both proven elsewhere and neither reachable from a
 * suite that opens no socket. **Every guard therefore lives in `osrmUrl`**, which is the whole
 * point — a bad mode, a bad coordinate or an absurd distance can be proven never to become a
 * request without stubbing anything.
 *
 * What is worth testing here is the class of bug this module can produce silently. OSRM takes
 * `lon,lat` where the rest of this repo writes `lat,lon`; reversed, a Paris route does not throw,
 * it returns a confident answer about the Gulf of Guinea. Nothing downstream can catch that.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "osrm-test-")), "test.db");

const {
  MAX_LEG_KM,
  osrmUrl,
  parseOsrmRoute,
  probeTransitAvailable,
  routableMode,
  routeCacheKey,
  routeDistanceKm,
  routeMinutes,
} = await import("./osrmRoute.ts");
const { travelLegBetween } = await import("./travelTime.ts");

/** Louvre → Palais-Royal, the pair the module's doc records a live measurement for. */
const LOUVRE = { lat: 48.8606, lon: 2.3364 };
const PALAIS = { lat: 48.8656, lon: 2.3376 };

/** Captured from `routed-foot` on 2026-09-11, trimmed to four vertices. Real payload shape, not
 *  one written from the OSRM docs — a response invented from a spec passes a test while the parser
 *  mishandles what the server actually sends. */
const LIVE_FOOT = {
  code: "Ok",
  routes: [
    {
      distance: 640.6,
      duration: 512.1,
      geometry: {
        type: "LineString",
        coordinates: [
          [2.336494, 48.860763],
          [2.3364, 48.860786],
          [2.336407, 48.860798],
          [2.336343, 48.860892],
        ],
      },
    },
  ],
};

test("the request is built lon,lat — the reverse of every other coordinate in this repo", () => {
  const url = osrmUrl(LOUVRE, PALAIS, "walk");
  assert.ok(
    url.includes("/2.3364,48.8606;2.3376,48.8656?"),
    "reversed coordinates do not error, they route somewhere plausible and wrong — this is the one assertion nothing downstream can make"
  );
});

test("drive maps to the routed-car host but the driving profile", () => {
  const url = osrmUrl(LOUVRE, PALAIS, "drive");
  assert.ok(url.includes("/routed-car/route/v1/driving/"), "the pair is asymmetric on purpose");
  assert.ok(osrmUrl(LOUVRE, PALAIS, "walk").includes("/routed-foot/route/v1/foot/"));
  assert.ok(osrmUrl(LOUVRE, PALAIS, "bike").includes("/routed-bike/route/v1/bike/"));
});

test("transit has no profile, so no request can be built for it", () => {
  assert.equal(routableMode("transit"), null);
  assert.equal(
    osrmUrl(LOUVRE, PALAIS, "transit"),
    null,
    "a mode nothing serves must be rejected before the network, not after"
  );
});

test("a leg longer than MAX_LEG_KM is rejected without a request", () => {
  const tokyo = { lat: 35.68, lon: 139.69 };
  assert.equal(osrmUrl(LOUVRE, tokyo, "drive"), null);
  // And the boundary is not so tight it rejects a real day excursion.
  const giverny = { lat: 49.0757, lon: 1.5331 };
  assert.ok(osrmUrl(LOUVRE, giverny, "drive"), "Paris to Giverny is 75km and is a real day trip");
  assert.equal(MAX_LEG_KM, 150);
});

test("a coordinate that is not a finite number in range is rejected", () => {
  assert.equal(osrmUrl({ lat: 91, lon: 2.33 }, PALAIS, "walk"), null, "latitude past the pole");
  assert.equal(osrmUrl({ lat: 48.86, lon: 181 }, PALAIS, "walk"), null, "longitude past the wrap");
  assert.equal(osrmUrl({ lat: NaN, lon: 2.33 }, PALAIS, "walk"), null);
  assert.equal(osrmUrl(LOUVRE, { lat: 48.86, lon: Infinity }, "walk"), null);
  // Null Island is a legal point and must NOT be rejected — it is what `Number(null)` produces,
  // so rejecting it here would hide the query-string bug instead of letting the route catch it.
  assert.ok(osrmUrl({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, "walk"));
});

test("a live payload parses to its own numbers, unrounded", () => {
  const route = parseOsrmRoute(LIVE_FOOT);
  assert.equal(route.distanceM, 640.6);
  assert.equal(route.durationS, 512.1);
});

test("geometry is flipped from [lon,lat] to {lat,lng}", () => {
  const route = parseOsrmRoute(LIVE_FOOT);
  assert.equal(route.geometry.length, 4);
  assert.deepEqual(route.geometry[0], { lat: 48.860763, lng: 2.336494 });
  assert.ok(
    route.geometry[0].lat > 48,
    "unflipped this reads 2.33, which is the Gulf of Guinea — a plausible number that draws the route into the sea"
  );
});

test("an unroutable pair reads as no answer, never as a route", () => {
  assert.equal(
    parseOsrmRoute({ code: "NoRoute", routes: [] }),
    null,
    "it must collapse into the same null as a timeout, or cached() would freeze 'no path exists' for ninety days"
  );
  assert.equal(parseOsrmRoute({ code: "InvalidQuery" }), null);
  assert.equal(parseOsrmRoute(null), null);
  assert.equal(parseOsrmRoute("nonsense"), null);
});

test("a route present but missing its numbers is null, never NaN", () => {
  assert.equal(
    parseOsrmRoute({ code: "Ok", routes: [{}] }),
    null,
    "NaN minutes propagate silently through every consumer and surface as 'NaN min' in the panel"
  );
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ distance: 500 }] }), null, "no duration");
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ duration: 500 }] }), null, "no distance");
  assert.equal(parseOsrmRoute({ code: "Ok", routes: [{ distance: "500", duration: 60 }] }), null);
});

test("numbers without readable geometry still answer", () => {
  const route = parseOsrmRoute({ code: "Ok", routes: [{ distance: 640.6, duration: 512.1 }] });
  assert.deepEqual(
    route,
    { distanceM: 640.6, durationS: 512.1, geometry: [] },
    "the planner wants the minutes; the map degrades to the arcs it already draws"
  );
  // A malformed vertex is skipped rather than poisoning the line.
  const partial = parseOsrmRoute({
    code: "Ok",
    routes: [
      { distance: 1, duration: 1, geometry: { coordinates: [[2.3, 48.8], "junk", [null, 4], [2.4, 48.9]] } },
    ],
  });
  assert.equal(partial.geometry.length, 2);
});

test("the cache key is direction-sensitive", () => {
  assert.notEqual(
    routeCacheKey(LOUVRE, PALAIS, "walk"),
    routeCacheKey(PALAIS, LOUVRE, "walk"),
    "one-way streets, barriers and stairs make a→b a different route from b→a; folding them looks like a free doubling of the hit rate and is wrong half the time"
  );
  assert.notEqual(routeCacheKey(LOUVRE, PALAIS, "walk"), routeCacheKey(LOUVRE, PALAIS, "drive"));
  assert.ok(routeCacheKey(LOUVRE, PALAIS, "walk").startsWith("osrm:foot:"), "namespace first");
  // 4dp, so sub-11m jitter shares a row but the far side of a river does not.
  assert.equal(
    routeCacheKey({ lat: 48.86060001, lon: 2.3364 }, PALAIS, "walk"),
    routeCacheKey(LOUVRE, PALAIS, "walk")
  );
  assert.notEqual(routeCacheKey({ lat: 48.8617, lon: 2.3364 }, PALAIS, "walk"), routeCacheKey(LOUVRE, PALAIS, "walk"));
});

test("transit remains unproven rather than absent", async () => {
  assert.equal(
    await probeTransitAvailable(),
    false,
    "false means 'not proven' — reconcile.ts degrades to an assumed walk plus transit rather than planning a car-only city"
  );
});

test("a real leg and an estimated one round the same way", () => {
  // Two roundings of the same quantity is how a measured leg and an estimated one start
  // disagreeing by a minute for no reason a reader could ever explain.
  assert.equal(routeMinutes({ distanceM: 640.6, durationS: 512.1, geometry: [] }), 9);
  assert.equal(routeDistanceKm({ distanceM: 640.6, durationS: 512.1, geometry: [] }), 0.6);
  assert.equal(routeDistanceKm({ distanceM: 1629.9, durationS: 292.2, geometry: [] }), 1.6);

  // The floor at 1 is travelLegBetween's, not a separate decision: a 40-second hop must not read
  // as "0 min" on one path and "1 min" on the other.
  assert.equal(routeMinutes({ distanceM: 30, durationS: 24, geometry: [] }), 1);
  assert.equal(
    travelLegBetween({ lat: 48.8606, lon: 2.3364 }, { lat: 48.86062, lon: 2.3364 }).minutes,
    1,
    "the estimate floors at 1 too — routeMinutes copies it rather than inventing its own floor"
  );
});
