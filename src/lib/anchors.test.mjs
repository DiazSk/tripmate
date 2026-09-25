/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/anchors.test.mjs
 *
 * The wizard's POI picker collected places for months that never reached the prompt. These pin the
 * one function every path now goes through, including the iOS wizard's legacy fields. */
import assert from "node:assert/strict";
import test from "node:test";
import { anchorKey, normalizeAnchors, readUnplaced } from "./anchors.ts";

test("anchorKey folds case, accents and punctuation", () => {
  assert.equal(anchorKey("  Café  de Flore! "), "cafe de flore");
  assert.equal(anchorKey("teamLab Planets"), anchorKey("TEAMLAB planets"));
  assert.equal(anchorKey("浅草寺"), "浅草寺");
});

test("legacy selectedPois and customPois become want anchors", () => {
  const out = normalizeAnchors({
    selectedPois: [{ name: "Fushimi Inari", lat: 34.96, lon: 135.77, category: "religion" }],
    customPois: ["Nishiki Market"],
  });
  assert.deepEqual(out, [
    { name: "Fushimi Inari", lat: 34.96, lng: 135.77, priority: "want", source: "picked" },
    { name: "Nishiki Market", lat: null, lng: null, priority: "want", source: "typed" },
  ]);
});

test("duplicates by key collapse, must wins, coordinates are kept", () => {
  const out = normalizeAnchors({
    anchors: [{ name: "teamLab Planets", lat: null, lng: null, priority: "must", source: "import" }],
    selectedPois: [{ name: "TeamLab Planets", lat: 35.65, lon: 139.79, category: "museum" }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].priority, "must");
  assert.equal(out[0].lat, 35.65);
});

test("malformed input is dropped, never thrown", () => {
  assert.deepEqual(normalizeAnchors(null), []);
  assert.deepEqual(normalizeAnchors({ anchors: "x", customPois: [3, "", "  "] }), []);
  assert.deepEqual(
    normalizeAnchors({ anchors: [{ name: "A", priority: "bogus", lat: "1", lng: 2 }] }),
    [{ name: "A", lat: null, lng: 2, priority: "want", source: undefined }]
  );
});

test("caps at 40 anchors", () => {
  const customPois = Array.from({ length: 60 }, (_, i) => `Place ${i}`);
  assert.equal(normalizeAnchors({ customPois }).length, 40);
});

test("a must past position 40 survives the cap; a want in its place does not", () => {
  const anchors = [
    ...Array.from({ length: 40 }, (_, i) => ({ name: `Want ${i}`, lat: null, lng: null, priority: "want" })),
    { name: "Late Must", lat: null, lng: null, priority: "must" },
  ];
  const out = normalizeAnchors({ anchors });
  assert.equal(out.length, 40);
  assert.ok(out.some((a) => a.name === "Late Must"), "the must at position 41 must survive the cap");
  assert.ok(!out.some((a) => a.name === "Want 39"), "a want should drop instead");
});

test("readUnplaced keeps only well-formed entries", () => {
  assert.deepEqual(readUnplaced("nope"), []);
  assert.deepEqual(readUnplaced(null), []);
  assert.deepEqual(
    readUnplaced([{ name: "Kawagoe", reason: "70 min each way" }, { name: "No reason" }, 4]),
    [{ name: "Kawagoe", reason: "70 min each way" }]
  );
});
