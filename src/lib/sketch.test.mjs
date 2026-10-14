/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/sketch.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { buildSketchPrompt, formatSketchForGenerate, parseSketch } from "./sketch.ts";
import { carryOverDaySummaries } from "./itinerary.ts";

const DATES = ["2026-10-06", "2026-10-07"];

test("the sketch prompt names the days, the musts and the ask", () => {
  const p = buildSketchPrompt({
    destination: "Tokyo", dates: DATES, priorities: ["Food"], weather: [],
    anchors: [{ name: "teamLab Planets", lat: 35.6, lng: 139.8, priority: "must" }],
  });
  assert.match(p, /2026-10-06/);
  assert.match(p, /MUST: teamLab Planets/);
  assert.match(p, /"theme"/);
});

test("parseSketch keeps one entry per requested date, in order", () => {
  const raw = JSON.stringify({ days: [
    { date: "2026-10-07", theme: "Bay and art", area: "Odaiba", anchors: ["teamLab Planets"] },
    { date: "2026-10-06", theme: "Old Tokyo, slowly", area: "Asakusa", anchors: [] },
    { date: "2026-12-01", theme: "Off-trip", area: "x", anchors: [] },
  ] });
  assert.deepEqual(parseSketch(raw, DATES).map((d) => d.theme), ["Old Tokyo, slowly", "Bay and art"]);
});

test("parseSketch returns null when it can't be used", () => {
  assert.equal(parseSketch("nope", DATES), null);
  assert.equal(parseSketch(JSON.stringify({ days: [] }), DATES), null);
});

test("formatSketchForGenerate is empty with no sketch and names each day otherwise", () => {
  assert.equal(formatSketchForGenerate(null), "");
  const out = formatSketchForGenerate([{ date: "2026-10-06", theme: "Old Tokyo, slowly", area: "Asakusa", anchors: ["Senso-ji"] }]);
  assert.match(out, /2026-10-06: "Old Tokyo, slowly", Asakusa \(Senso-ji\)/);
  assert.match(out, /keep this shape/i);
});

test("critique's revised days inherit the theme", () => {
  const revised = [{ date: "2026-10-06", weather: "", stops: [] }];
  carryOverDaySummaries(revised, [{ date: "2026-10-06", weather: "", stops: [], theme: "Old Tokyo, slowly" }]);
  assert.equal(revised[0].theme, "Old Tokyo, slowly");
});
