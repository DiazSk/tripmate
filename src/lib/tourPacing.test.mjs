/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/tourPacing.test.mjs
 *
 * The tour's camera maths, which is all of it that `npm test` can reach — the renderers are
 * browser-only. The bearing is the part worth pinning: it is the difference between arriving
 * facing the next place and arriving facing north, and nothing on screen would tell you which
 * one shipped. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bearingRad,
  legBearingRad,
  tourFlightSeconds,
  travelFollowSeconds,
  TOUR_HOLD_MS,
} from "./tourPacing.ts";

const deg = (rad) => (rad * 180) / Math.PI;
/** Bearings are floats; a hundredth of a degree is far below anything a camera shows. */
const closeToDeg = (actual, expected, what) =>
  assert.ok(
    Math.abs(deg(actual) - expected) < 0.01,
    `${what}: expected ~${expected}°, got ${deg(actual).toFixed(4)}°`
  );

const at = (lat, lng) => ({ lat, lng });

test("bearingRad: the four cardinals from the equator", () => {
  closeToDeg(bearingRad(at(0, 0), at(1, 0)), 0, "north");
  closeToDeg(bearingRad(at(0, 0), at(0, 1)), 90, "east");
  closeToDeg(bearingRad(at(0, 0), at(-1, 0)), 180, "south");
  closeToDeg(bearingRad(at(0, 0), at(0, -1)), 270, "west");
});

test("bearingRad: a hop across the antimeridian is east, not south", () => {
  // The flat atan2(Δlng·cosφ, Δlat) approximation reports ~270° here, because its Δlng is -359.98
  // rather than +0.02. This is the whole reason the spherical form is used.
  closeToDeg(bearingRad(at(0, 179.99), at(0, -179.99)), 90, "eastward across 180");
  closeToDeg(bearingRad(at(0, -179.99), at(0, 179.99)), 270, "westward across 180");
});

test("bearingRad: is always in [0, 2pi)", () => {
  for (const [a, b] of [
    [at(35.01, 135.77), at(34.99, 135.75)],
    [at(-33.87, 151.21), at(-36.85, 174.76)],
    [at(64.15, -21.94), at(-33.92, 18.42)],
  ]) {
    const θ = bearingRad(a, b);
    assert.ok(θ >= 0 && θ < 2 * Math.PI, `out of range: ${θ}`);
  }
});

test("legBearingRad: faces the next stop", () => {
  const stops = [at(0, 0), at(1, 0), at(1, 1)];
  closeToDeg(legBearingRad(stops, 0), 0, "leg 0 heads north");
  closeToDeg(legBearingRad(stops, 1), 90, "leg 1 heads east");
});

test("legBearingRad: the last stop keeps the bearing it arrived on", () => {
  // Snapping north on the final frame would undo the whole point on the one stop the tour ends on.
  const stops = [at(0, 0), at(1, 0)];
  closeToDeg(legBearingRad(stops, 1), 0, "arrived heading north, still facing north");
});

test("legBearingRad: a co-located next stop is skipped, not faced", () => {
  // "Lunch at the temple café" sits on the temple's coordinates. atan2(0,0) is silently 0 — due
  // north — so without the skip the tour would claim a direction it does not have.
  const stops = [at(0, 0), at(0, 0.00005), at(0, 1)]; // ~5m, then ~111km east
  closeToDeg(legBearingRad(stops, 0), 90, "skips the co-located stop and faces the real next one");
});

test("legBearingRad: falls back past co-located stops behind it too", () => {
  const stops = [at(0, 0), at(1, 0), at(1, 0.00005)];
  closeToDeg(legBearingRad(stops, 2), 0, "nothing ahead, nothing near behind — uses the real leg");
});

test("legBearingRad: null where there is no direction of travel", () => {
  assert.equal(legBearingRad([at(0, 0)], 0), null, "single-stop day");
  assert.equal(legBearingRad([at(0, 0), at(0, 0.00005)], 0), null, "a whole day at one coordinate");
  assert.equal(legBearingRad([], 0), null, "no stops");
  assert.equal(legBearingRad([at(0, 0)], 7), null, "index past the end");
});

test("tourFlightSeconds: a short hop keeps the flight the app already had", () => {
  // Under TOUR_FLIGHT_NEAR_M both stops share one frame, so it is a pan and buys no extra time.
  assert.equal(tourFlightSeconds(0), 1.2);
  assert.equal(tourFlightSeconds(400), 1.2);
  assert.equal(tourFlightSeconds(500), 1.2);
});

test("tourFlightSeconds: grows with distance and caps", () => {
  assert.ok(Math.abs(tourFlightSeconds(1000) - 1.7) < 1e-9, "one doubling");
  assert.ok(Math.abs(tourFlightSeconds(2000) - 2.2) < 1e-9, "two doublings");
  assert.equal(tourFlightSeconds(20000), 2.8, "a long leg caps");
  assert.equal(tourFlightSeconds(20_000_000), 2.8, "and stays capped");
});

test("tourFlightSeconds: a doubleback is paid for, by the shorter arc", () => {
  const straight = tourFlightSeconds(500, 0);
  const reversal = tourFlightSeconds(500, Math.PI);
  assert.ok(reversal > straight, "180° costs more than 0°");
  assert.ok(Math.abs(reversal - 2.2) < 1e-9, "a full reversal buys one extra second");
  // 350° clockwise is 10° anticlockwise, and both engines interpolate the short way round — so
  // charging for 350 would buy time for travel that never happens.
  const longWay = tourFlightSeconds(500, (350 * Math.PI) / 180);
  const shortWay = tourFlightSeconds(500, (-10 * Math.PI) / 180);
  assert.ok(Math.abs(longWay - shortWay) < 1e-9, "350° is priced as 10°");
});

test("a step is shorter than the metronome it replaces", () => {
  // The old fixed 6500ms was 1.2s of flight and ~5.3s of stillness. Every leg must now come in
  // under that, or "less slideshow" would have made the tour longer.
  for (const legM of [0, 500, 2000, 20000]) {
    const step = tourFlightSeconds(legM, Math.PI) * 1000 + TOUR_HOLD_MS;
    assert.ok(step < 6500, `leg ${legM}m worst-case step ${Math.round(step)}ms should beat 6500ms`);
  }
});

/* --- travelFollowSeconds ---
 *
 * The narration is the clock; the ground speed is what gives. Both clamps matter: a camera under
 * the floor reads as stopped, and one over the ceiling reads as a whip pan with no legible ground. */

test("a narration inside the speed band sets the duration outright", () => {
  // 1200m over 8s is 150 m/s — comfortably between the floor and the ceiling.
  assert.equal(travelFollowSeconds(1200, 8000), 8);
});

test("a long line over a short walk is capped rather than crawling", () => {
  // 200m over 30s would be 6.7 m/s, well under the floor: the camera would read as stopped.
  const seconds = travelFollowSeconds(200, 30_000);
  assert.ok(seconds < 30, "the flight ends early and holds, rather than crawling for half a minute");
  assert.ok(Math.abs(seconds - 200 / 25) < 0.001, "clamped to the minimum speed");
});

test("a long drive under a short line is capped rather than whip-panning", () => {
  // 20km over 2s would be 10,000 m/s.
  const seconds = travelFollowSeconds(20_000, 2_000);
  assert.ok(seconds > 2, "the camera takes longer than the sentence rather than blurring the ground");
  assert.ok(Math.abs(seconds - 20_000 / 400) < 0.001, "clamped to the maximum speed");
});

test("a zero-length path falls back to the narration and never divides by it", () => {
  assert.equal(travelFollowSeconds(0, 5_000), 5);
  assert.ok(Number.isFinite(travelFollowSeconds(0, 0)));
  assert.ok(Number.isFinite(travelFollowSeconds(NaN, 4_000)));
  assert.ok(travelFollowSeconds(500, -100) > 0, "a negative narration still yields a real flight");
});
