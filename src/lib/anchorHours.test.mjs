/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/anchorHours.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { attachHours, fetchAnchorHours } from "./anchorHours.ts";

const NIJO = { name: "Nijo Castle", lat: 35.0142, lng: 135.7481, priority: "must" };
const UFFIZI = { name: "Uffizi Gallery", lat: 43.7678, lng: 11.2553, priority: "want" };
const TYPED = { name: "My aunt's café", lat: null, lng: null, priority: "want" };
const tag = (openingHours) => ({ openingHours, lat: null, lon: null, wheelchair: null });

test("attachHours adds hours and the closed days they imply", () => {
  const [nijo, uffizi] = attachHours([NIJO, UFFIZI], {
    "Nijo Castle": tag("Mo-Su 08:45-17:00"),
    "Uffizi Gallery": tag("Tu-Su 08:15-18:30"),
  });
  assert.equal(nijo.openingHours, "Mo-Su 08:45-17:00");
  assert.deepEqual(nijo.closedDays, []);
  assert.deepEqual(uffizi.closedDays, ["Mo"]);
});

test("attachHours leaves an anchor untouched when OSM has no hours for it", () => {
  const out = attachHours([NIJO], { "Nijo Castle": tag(null) });
  assert.deepEqual(out[0], NIJO);
  assert.deepEqual(attachHours([NIJO], null)[0], NIJO, "a failed fetch changes nothing");
});

test("fetchAnchorHours queries only located anchors and keeps the rest", async () => {
  let asked = null;
  const out = await fetchAnchorHours([NIJO, TYPED], async (pois) => {
    asked = pois;
    return { "Nijo Castle": tag("Mo-Su 08:45-17:00") };
  });
  assert.deepEqual(asked, [{ name: "Nijo Castle", lat: 35.0142, lon: 135.7481 }]);
  assert.equal(out[0].openingHours, "Mo-Su 08:45-17:00");
  assert.deepEqual(out[1], TYPED, "the typed place still reaches the prompt, without hours");
});

test("fetchAnchorHours makes no call when nothing is located", async () => {
  let called = false;
  const out = await fetchAnchorHours([TYPED], async () => ((called = true), {}));
  assert.equal(called, false);
  assert.deepEqual(out, [TYPED]);
});

test("fetchAnchorHours gives up at its budget and changes nothing", async () => {
  const slow = () => new Promise((resolve) => setTimeout(() => resolve({ "Nijo Castle": tag("X") }), 500));
  const started = Date.now();
  const out = await fetchAnchorHours([NIJO], slow, 50);
  assert.ok(Date.now() - started < 400, "did not wait for the slow lookup");
  assert.deepEqual(out, [NIJO]);
});

test("fetchAnchorHours survives a lookup that throws", async () => {
  const out = await fetchAnchorHours([NIJO], async () => {
    throw new Error("overpass down");
  });
  assert.deepEqual(out, [NIJO]);
});

test("fetchAnchorHours says so when the lookup comes back empty", async () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(" "));
  try {
    await fetchAnchorHours([NIJO], async () => null);
    await fetchAnchorHours([NIJO], () => new Promise(() => {}), 20);
  } finally {
    console.warn = orig;
  }
  assert.equal(warned.length, 2, "a failed and a timed-out lookup each leave a line in the log");
  assert.match(warned[1], /20ms/);
});
