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
  assert.match(p, /MUST: <traveler_text>teamLab Planets<\/traveler_text>/);
  assert.match(p, /"theme"/);
});

// The theme's guidance used to be one real example, "Old Tokyo, slowly", and a Lisbon plan came back
// with a day titled "Old Tokyo, slowly (local, unhurried)". The ask now describes the shape against
// the trip's own destination, so there is no other city in the prompt for the model to borrow.
test("the sketch prompt ties each theme to this destination and borrows no other place", () => {
  const p = buildSketchPrompt({ destination: "Lisbon, Portugal", dates: DATES, priorities: [], weather: [], anchors: [] });
  assert.match(p, /"theme" of 2-5 evocative words about that day in Lisbon, Portugal/);
  assert.doesNotMatch(p, /Tokyo|e\.g\./);
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
