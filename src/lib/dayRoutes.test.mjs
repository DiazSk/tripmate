/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/dayRoutes.test.mjs
 *
 * Only `routeKey` is covered, and it is the piece worth covering: it decides what counts as "the
 * same day" for every consumer at once, and both ways of getting it wrong are quiet. Too loose and
 * a reordered day shows the previous order's numbers; too tight and floating-point noise in a
 * coordinate round-trip misses the cache and re-asks a free community service on every render.
 *
 * The fetch path and the hook are not covered — nothing renders in this suite and it opens no
 * socket.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_PROFILES, meaningfulLeg, routeKey } from "./dayRoutes.ts";

const day = [
  { lat: 48.8606, lng: 2.3364 },
  { lat: 48.8656, lng: 2.3376 },
  { lat: 48.86, lng: 2.3266 },
];

test("the profile is part of the key, which is why switching invalidates nothing", () => {
  assert.notEqual(routeKey("walk", day), routeKey("drive", day));
  // walk -> drive is a miss on a different key; drive -> walk is a hit on a warm one. No eviction
  // path exists because none is needed.
  assert.equal(routeKey("walk", day), routeKey("walk", day));
  assert.equal(ROUTE_PROFILES.length, 3, "transit is absent: nothing free routes it");
});

test("reordering a day is a different day", () => {
  const reordered = [day[1], day[0], day[2]];
  assert.notEqual(
    routeKey("walk", reordered),
    routeKey("walk", day),
    "a drag-and-drop reorder changes every leg, and this app reorders days more than it does anything else"
  );
});

test("sub-metre jitter is the same day", () => {
  const jittered = day.map((s) => ({ lat: s.lat + 0.0000004, lng: s.lng - 0.0000004 }));
  assert.equal(
    routeKey("walk", jittered),
    routeKey("walk", day),
    "5dp is ~1m — finer than any edit that could change a route, so coordinate round-tripping must not re-ask"
  );
});

test("moving a stop a block is a different day", () => {
  const moved = [{ lat: day[0].lat + 0.001, lng: day[0].lng }, day[1], day[2]];
  assert.notEqual(routeKey("walk", moved), routeKey("walk", day));
});

test("adding a stop is a different day", () => {
  assert.notEqual(routeKey("walk", day.slice(0, 2)), routeKey("walk", day));
});

test("a leg between two stops at the same address is not a journey", () => {
  // Observed on a real Paris day: a stop and the Velib' dock outside it rendered as
  // "1 min walk · 0 m", because formatDuration floors at a minute and formatDistance rounds to
  // ten metres. Both roundings are right; the leg should never have reached them.
  assert.equal(meaningfulLeg({ distanceM: 0, durationS: 2, points: [] }), null);
  assert.equal(meaningfulLeg({ distanceM: 39, durationS: 30, points: [] }), null);
  assert.equal(meaningfulLeg(null), null, "an unroutable leg stays unroutable");
  assert.equal(meaningfulLeg(undefined), null, "routes not landed yet");

  const real = { distanceM: 640.6, durationS: 512.1, points: [] };
  assert.equal(meaningfulLeg(real), real, "a real walk passes through unchanged");
});
