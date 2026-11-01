/* Run: node --test src/lib/stopCoords.test.mjs
 *
 * A model writing a coordinate drops a sign or swaps the pair often enough to matter, and nothing
 * downstream throws: the stop saves, the pin lands at sea, and the film flies there. The Porto case
 * below is the one an E2E run hit, a chat-added "Coffee near Se" at 41.145, +8.612. */
import assert from "node:assert/strict";
import test from "node:test";
import { checkStopCoord } from "./stopCoords.ts";

const porto = [
  { lat: 41.1428, lon: -8.6112 },
  { lat: 41.1456, lon: -8.6145 },
  { lat: 41.144, lon: -8.611 },
];

test("a point among the trip's stops is left alone", () => {
  assert.deepEqual(checkStopCoord({ lat: 41.15, lng: -8.62 }, porto), { kind: "ok" });
});

test("a dropped longitude sign is put back", () => {
  assert.deepEqual(checkStopCoord({ lat: 41.145, lng: 8.612 }, porto), { kind: "fixed", lat: 41.145, lng: -8.612 });
});

test("a dropped latitude sign and a swapped pair are put back", () => {
  const sydney = [{ lat: -33.8568, lon: 151.2153 }];
  assert.deepEqual(checkStopCoord({ lat: 33.86, lng: 151.21 }, sydney), { kind: "fixed", lat: -33.86, lng: 151.21 });
  assert.deepEqual(checkStopCoord({ lat: -8.612, lng: 41.145 }, porto), { kind: "fixed", lat: 41.145, lng: -8.612 });
});

test("a far point no correction brings near is refused", () => {
  assert.deepEqual(checkStopCoord({ lat: 48.8584, lng: 2.2945 }, porto), { kind: "far" });
});

test("a plausible side trip stays as written", () => {
  // Lisbon from Porto is ~275km: a long day, not a typo.
  assert.deepEqual(checkStopCoord({ lat: 38.7223, lng: -9.1393 }, porto), { kind: "ok" });
});

test("nothing to compare with, or no coordinate at all, says nothing", () => {
  assert.deepEqual(checkStopCoord({ lat: 41.145, lng: 8.612 }, []), { kind: "ok" });
  assert.deepEqual(checkStopCoord({ lat: undefined, lng: undefined }, porto), { kind: "ok" });
});

test("an out-of-range latitude is never kept", () => {
  assert.deepEqual(checkStopCoord({ lat: -8.612, lng: 141.145 }, porto), { kind: "far" });
  assert.deepEqual(checkStopCoord({ lat: 95, lng: -8.6 }, []), { kind: "far" });
});

test("fixTypoCoords repairs only the typo'd stops, in place", async () => {
  const { fixTypoCoords } = await import("./stopCoords.ts");
  const stops = [{ lat: 41.145, lng: 8.612 }, { lat: 41.15, lng: -8.62 }, { lat: 48.8584, lng: 2.2945 }];
  assert.equal(fixTypoCoords(stops, porto), 1);
  assert.deepEqual(stops, [{ lat: 41.145, lng: -8.612 }, { lat: 41.15, lng: -8.62 }, { lat: 48.8584, lng: 2.2945 }]);
});
