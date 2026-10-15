/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/dayGaps.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import { addPlaceAt, bestGap, fitInGap, gapsOfDay, suitsGap, walkMinutes } from "./dayGaps.ts";
import { parseClockTime } from "./timeOfDay.ts";

// Lisbon, Baixa. 0.001 deg of latitude is ~111m.
const LAT = 38.71;
const LNG = -9.14;
const stop = (name, time, durationLabel = "1 hour", dLat = 0) => ({
  name,
  time,
  durationLabel,
  lat: LAT + dLat,
  lng: LNG,
  cost: 0,
  note: "",
  category: "other",
});
const near = (dLat, extra = {}) => ({ lat: LAT + dLat, lng: LNG, category: "cafe", ...extra });
const H = (h, m = 0) => h * 60 + m;

const day = [stop("Castle", "10:00 AM", "2 hours"), stop("Lunch", "1:00 PM", "1 hour"), stop("Dinner", "7:30 PM", "90 minutes")];

test("gaps are the holes of 40 minutes or more between timed stops, 9 AM to 10 PM", () => {
  const gaps = gapsOfDay(day);
  assert.deepEqual(
    gaps.map((g) => [g.start, g.end, g.before, g.after]),
    [
      [H(9), H(10), null, 0],
      [H(12), H(13), 0, 1],
      [H(14), H(19, 30), 1, 2],
      // Dinner ends 9 PM, an hour before the day does.
      [H(21), H(22), 2, null],
    ],
  );
});

test("a short breath between stops is not a gap, and untimed stops are ignored", () => {
  const gaps = gapsOfDay([stop("A", "9:00 AM", "1 hour"), stop("B", "10:30 AM", "11 hours 30 minutes"), stop("Loose", "", "")]);
  assert.deepEqual(gaps, []);
});

test("an empty day is one gap from morning to night with nothing to walk from", () => {
  const [gap] = gapsOfDay([]);
  assert.deepEqual([gap.start, gap.end], [H(9), H(22)]);
  assert.deepEqual(fitInGap(near(0), gap, [], "2026-10-15"), { ok: false, why: "Nothing in the day to walk from" });
});

test("walking is priced over streets, never zero", () => {
  assert.equal(walkMinutes({ lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }), 1);
  // ~556m straight, ~723m over streets at 4.5 km/h.
  assert.equal(walkMinutes({ lat: LAT, lng: LNG }, { lat: LAT + 0.005, lng: LNG }), 10);
});

test("a nearby café fits the afternoon gap after the walk from lunch, on a five-minute mark", () => {
  const gaps = gapsOfDay(day);
  const fit = fitInGap(near(0.002), gaps[2], day, "2026-10-15");
  assert.equal(fit.ok, true);
  // Lunch ends 2 PM, ~4 min walk, rounded up to 2:05.
  assert.equal(fit.start, H(14, 5));
  assert.equal(fit.end, H(14, 35));
});

test("a place out of walking reach says how far it is from the stop", () => {
  const fit = fitInGap(near(0.03), gapsOfDay(day)[2], day, "2026-10-15");
  assert.equal(fit.ok, false);
  assert.match(fit.why, /^\d+ min walk from Lunch$/);
});

test("a place closed on the day's weekday does not fit, and unknown hours never close it", () => {
  const gap = gapsOfDay(day)[2];
  // 2026-10-15 is a Thursday.
  assert.deepEqual(fitInGap(near(0.001, { openingHours: "Mo-We,Fr-Su 09:00-18:00" }), gap, day, "2026-10-15"), {
    ok: false,
    why: "Closed on Thursday",
  });
  assert.equal(fitInGap(near(0.001, { openingHours: "by appointment" }), gap, day, "2026-10-15").ok, true);
});

test("a visit that runs past the next stop says what it needs against what the gap has", () => {
  const fit = fitInGap(near(0.001, { category: "restaurant" }), gapsOfDay(day)[1], day, "2026-10-15");
  assert.equal(fit.ok, false);
  assert.match(fit.why, /^Needs 1h 1\dm, the gap is 1h$/);
});

test("the best gap is the first one the place fits", () => {
  const fit = bestGap(near(0.001, { category: "restaurant" }), gapsOfDay(day), day, "2026-10-15");
  assert.equal(fit?.gap.start, H(14));
});

test("what suits a gap follows the hour it falls in", () => {
  const [morning, , afternoon, evening] = gapsOfDay(day);
  assert.deepEqual(suitsGap(morning), ["cafe", "sights"]);
  assert.deepEqual(suitsGap(afternoon), ["sights", "cafe"]);
  assert.deepEqual(suitsGap(evening), ["restaurant", "bar"]);
});

test("a place added at a time lands among the timed stops and moves nothing", () => {
  const itinerary = { tier: "standard", days: [{ date: "2026-10-15", stops: day }] };
  const next = addPlaceAt(itinerary, 0, { name: "Café", lat: LAT, lng: LNG, category: "cafe" }, H(14, 5));
  const stops = next.days[0].stops;
  assert.deepEqual(stops.map((s) => s.name), ["Castle", "Lunch", "Café", "Dinner"]);
  assert.equal(stops[2].time, "2:05 PM");
  assert.equal(stops[2].category, "food");
  assert.deepEqual(stops.filter((s) => s.name !== "Café").map((s) => s.time), day.map((s) => s.time));
  assert.equal(itinerary.days[0].stops.length, 3);
  // After the last stop, it goes on the end.
  const late = addPlaceAt(itinerary, 0, { name: "Bar", lat: LAT, lng: LNG, category: "bar" }, H(21, 5));
  assert.equal(late.days[0].stops.at(-1).name, "Bar");
  assert.equal(parseClockTime(late.days[0].stops.at(-1).time), H(21, 5));
});
