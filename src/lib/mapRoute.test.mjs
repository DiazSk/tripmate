import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_COLOR_TOKENS,
  arcLift,
  buildDayClusters,
  dayColorToken,
  DAY_LABEL_LIFT_M,
  dayPhase,
  dayVisualState,
  frameRouteBesidePanel,
} from "./mapRoute.ts";


/** A day's worth of stops at the given coordinates. `day` is what the colour ramp and the
 *  cluster labels are keyed on, so it is set explicitly rather than inferred. */
const day = (index, coords) =>
  coords.map(([lat, lng], i) => ({ lat, lng, name: `stop ${i}`, day: index }));

test("day 1 keeps the colour the single-day route always used", () => {
  // The whole point of anchoring the ramp here: a one-day trip must look untouched.
  assert.equal(dayColorToken(0), "--route-blue");
});

test("each of the first six days gets a distinct colour", () => {
  const tokens = [0, 1, 2, 3, 4, 5].map(dayColorToken);
  assert.equal(new Set(tokens).size, 6);
});

test("the ramp cycles rather than running off the end", () => {
  // A 30-day trip is expressible; `undefined` reaching Cesium.Color.fromCssColorString throws
  // and would take the whole route with it.
  assert.equal(dayColorToken(6), dayColorToken(0));
  assert.equal(dayColorToken(13), dayColorToken(1));
  for (const i of [0, 7, 29, 100]) {
    assert.ok(DAY_COLOR_TOKENS.includes(dayColorToken(i)));
  }
});

test("consecutive days never share a colour", () => {
  // The one thing the colour has to do. Cycling is fine; two adjacent clusters in the same
  // colour is the failure that would make the ramp pointless.
  for (let i = 0; i < 40; i++) {
    assert.notEqual(dayColorToken(i), dayColorToken(i + 1));
  }
});

test("a cluster sits at the mean of its day's stops", () => {
  const [cluster] = buildDayClusters([
    day(0, [
      [10, 20],
      [20, 40],
    ]),
  ]);
  assert.equal(cluster.lat, 15);
  assert.equal(cluster.lng, 30);
});

test("the centroid follows the mass, not the bounding box", () => {
  // Four stops in one quarter and one across town: the label belongs with the four. A
  // bounding-box centre would put it at 5, in the gap between them.
  const [cluster] = buildDayClusters([
    day(0, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 10],
    ]),
  ]);
  assert.equal(cluster.lng, 2);
});

test("a day with no stops produces no cluster, and does not shift the days after it", () => {
  // The bug this guards: using the array position as `day` would relabel and recolour every
  // day after an empty one, so the map and the panel would disagree about which day is which.
  const clusters = buildDayClusters([day(0, [[1, 1]]), [], day(2, [[3, 3]])]);
  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters.map((c) => c.day),
    [0, 2]
  );
  assert.equal(clusters[1].label, "Day 3");
  assert.equal(clusters[1].colorToken, dayColorToken(2));
});

test("labels are one-based, matching the panel's day tabs", () => {
  const clusters = buildDayClusters([day(0, [[1, 1]]), day(1, [[2, 2]])]);
  assert.deepEqual(
    clusters.map((c) => c.label),
    ["Day 1", "Day 2"]
  );
});

test("an itinerary with no stops at all yields no clusters", () => {
  assert.deepEqual(buildDayClusters([]), []);
  assert.deepEqual(buildDayClusters([[], []]), []);
});

// --- Framing beside the panel ---------------------------------------------------------------
// 60° horizontal fov, Cesium's default, so the numbers below are the real ones.
const TAN_HALF_FOV = Math.tan(Math.PI / 6);

/** Where a point `biasM` east of the route's centre lands on screen, in pixels from the left.
 *  The aim point always projects to the viewport centre, so the route sits that far west of it.
 *  `tanHalfFov` must match whatever the framing was computed with, or this measures a different
 *  lens than the one under test. */
const routeCentreOnScreen = ({ biasM, rangeM }, viewWidth, tanHalfFov = TAN_HALF_FOV) => {
  const metresPerPx = (2 * rangeM * tanHalfFov) / viewWidth;
  return viewWidth / 2 - biasM / metresPerPx;
};

test("with no panel, the route stays in the middle of the screen", () => {
  const framing = frameRouteBesidePanel(1000, 1440, 1440, TAN_HALF_FOV);
  assert.equal(framing.biasM, 0);
  assert.equal(routeCentreOnScreen(framing, 1440), 720);
});

test("the route lands in the middle of the strip the panel leaves", () => {
  // The whole point of the feature: a 1440px viewport with the panel's left edge at 900 should
  // centre the route at 450, not 720 — otherwise half the day sits under the panel and an equal
  // band of dead space opens on the left.
  const framing = frameRouteBesidePanel(1000, 1440, 900, TAN_HALF_FOV);
  assert.ok(Math.abs(routeCentreOnScreen(framing, 1440) - 450) < 0.001);
});

test("the aim holds for any panel width", () => {
  for (const freeWidth of [1200, 900, 700, 520]) {
    const framing = frameRouteBesidePanel(800, 1440, freeWidth, TAN_HALF_FOV);
    assert.ok(
      Math.abs(routeCentreOnScreen(framing, 1440) - freeWidth / 2) < 0.001,
      `free strip ${freeWidth}`
    );
  }
});

test("the camera pulls back so the route fits the strip rather than the viewport", () => {
  const wide = frameRouteBesidePanel(1000, 1440, 1440, TAN_HALF_FOV);
  const narrow = frameRouteBesidePanel(1000, 1440, 720, TAN_HALF_FOV);
  // Half the width to work with means twice the distance.
  assert.ok(Math.abs(narrow.rangeM / wide.rangeM - 2) < 0.001);
});

test("a sliver of free space does not fling the camera into orbit", () => {
  // A narrow desktop window against the panel's 360px minimum. Without the clamp this divides
  // by the sliver and pulls back far enough to lose the city, which is worse than letting the
  // route run a little under the panel's edge.
  const framing = frameRouteBesidePanel(1000, 1440, 20, TAN_HALF_FOV);
  const unclamped = frameRouteBesidePanel(1000, 1440, 1440, TAN_HALF_FOV);
  assert.ok(framing.rangeM <= unclamped.rangeM * 2.5 + 0.001);
});

test("the range floor still applies to a single stop", () => {
  // A lone stop gives a zero-radius sphere; without the floor the camera drives into the mesh.
  assert.equal(frameRouteBesidePanel(0, 1440, 1440, TAN_HALF_FOV).rangeM, 800);
});

test("a full-bleed panel is treated as no panel", () => {
  // The phone layout. There is no strip to aim at, so centred framing is the correct answer
  // rather than a division by zero.
  assert.equal(frameRouteBesidePanel(1000, 390, 0, TAN_HALF_FOV).biasM, 0);
  assert.equal(frameRouteBesidePanel(1000, 390, 390, TAN_HALF_FOV).biasM, 0);
});

test("a nonsense viewport measurement centres rather than throwing", () => {
  for (const [view, free] of [[0, 0], [-1, 100], [1440, -5], [NaN, 100], [1440, NaN]]) {
    const framing = frameRouteBesidePanel(1000, view, free, TAN_HALF_FOV);
    assert.equal(framing.biasM, 0);
    assert.ok(Number.isFinite(framing.rangeM));
  }
});

test("the shift tracks the lens, and both lenses still centre the route in the strip", () => {
  // The conversion is real geometry, not a tuned constant. A wider lens covers more world per
  // pixel, so clearing the same panel edge takes more metres — and the route lands in the middle
  // of the strip either way, which is the invariant that actually matters.
  const narrowLens = Math.tan(Math.PI / 12);
  const wideLens = Math.tan(Math.PI / 6);
  const narrow = frameRouteBesidePanel(1000, 1440, 900, narrowLens);
  const wide = frameRouteBesidePanel(1000, 1440, 900, wideLens);
  assert.ok(wide.biasM > narrow.biasM);
  assert.ok(Math.abs(routeCentreOnScreen(narrow, 1440, narrowLens) - 450) < 0.001);
  assert.ok(Math.abs(routeCentreOnScreen(wide, 1440, wideLens) - 450) < 0.001);
});

// --- Label placement ---------------------------------------------------------------------
// The badge is anchored ON the day's route — the stop nearest that day's centre — and lifted
// above it by DAY_LABEL_LIFT_M in the marker layer. Height is what separates it from the pins,
// so nothing here moves it sideways. See buildDayClusters for the two sideways placements that
// were tried and read as detached.

/** Is this label exactly on one of the day's stops? */
const onAStop = (c, stops) =>
  stops.some(([lat, lng]) => Math.abs(c.labelLat - lat) < 1e-12 && Math.abs(c.labelLng - lng) < 1e-12);

test("the cluster centre is still the mean of its stops", () => {
  const [c] = buildDayClusters([day(0, [[10, 20], [20, 40]])]);
  assert.equal(c.lat, 15);
  assert.equal(c.lng, 30);
});

test("the radius still reaches the furthest stop, for anything that asks how big a day is", () => {
  const [c] = buildDayClusters([day(0, [[0, 0], [0, 4]])]);
  assert.ok(Math.abs(c.radiusDeg - 2) < 1e-9);
});

test("the label sits on the route, not out beside it", () => {
  const coords = [[0, 0], [0, 0.02], [0, 0.04]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(onAStop(c, coords), "label is on one of the day's own stops");
});

test("it takes the stop nearest the day's centre", () => {
  // Centre of these is lng 0.05; the middle stop at 0.04 is nearest it.
  const [c] = buildDayClusters([day(0, [[0, 0], [0, 0.04], [0, 0.11]])]);
  assert.ok(Math.abs(c.labelLng - 0.04) < 1e-12, `labelLng ${c.labelLng}`);
});

test("a bent day labels on its route, not in the block it goes around", () => {
  // An L-shaped afternoon: the centroid falls inside the corner, off the line entirely. The
  // reason the anchor is a stop rather than the centre.
  const coords = [[0, 0], [0, 0.04], [0.04, 0.04]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(onAStop(c, coords));
});

test("a long thin day labels on its line rather than a kilometre off it", () => {
  // The circumradius rule put this day's badge ~0.2 degrees away; it is now on the route.
  const coords = [[0, 0], [0, 0.2], [0, 0.4]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(onAStop(c, coords));
  assert.ok(Math.hypot(c.labelLat - c.lat, c.labelLng - c.lng) < 1e-9, "and at the centre stop");
});

test("nearest-stop is measured with longitude scaled by cos(lat)", () => {
  // At 60N a degree of longitude is half a degree of latitude on the ground. Centre is
  // (60.02, 0.03). The stop 0.04 east of centre is ~0.02 degrees-equivalent away; the one 0.03
  // north is 0.03. So the eastern stop is nearer on the ground and must win — an unscaled
  // comparison would pick the northern one.
  const coords = [[60, 0], [60.05, 0.03], [60.01, 0.07]];
  const [c] = buildDayClusters([day(0, coords)]);
  assert.ok(Math.abs(c.labelLat - 60.01) < 1e-12 && Math.abs(c.labelLng - 0.07) < 1e-12,
    `picked ${c.labelLat},${c.labelLng}`);
});

test("a day whose stops share one spot labels on that spot", () => {
  const [c] = buildDayClusters([day(0, [[10, 10], [10, 10]])]);
  assert.equal(c.radiusDeg, 0);
  assert.equal(c.labelLat, 10);
  assert.equal(c.labelLng, 10);
});

test("an empty day still contributes no cluster and shifts nothing after it", () => {
  const clusters = buildDayClusters([day(0, [[1, 1]]), [], day(2, [[3, 3]])]);
  assert.deepEqual(clusters.map((c) => c.day), [0, 2]);
  assert.equal(clusters[1].label, "Day 3");
});

test("the lift clears the tallest arc, or the badge sits inside its own line", () => {
  // MAX_ARC_LIFT_M is 180m above stem top; anything less than that leaves the label buried in
  // the arc at an oblique camera angle, which is the whole reason the lift exists.
  assert.ok(DAY_LABEL_LIFT_M > 180);
});

// --- Day visual state -------------------------------------------------------------------------

test("with nothing selected every day is baseline, and hover changes nothing", () => {
  // There is no dimming to lift, so hover has nothing to say.
  assert.equal(dayVisualState(0, null, null), "baseline");
  assert.equal(dayVisualState(3, null, 3), "baseline");
});

test("the selected day is active and the rest dim behind it", () => {
  assert.equal(dayVisualState(1, 1, null), "active");
  assert.equal(dayVisualState(0, 1, null), "dimmed");
});

test("hovering a dimmed day lifts only that day, and never the selection", () => {
  assert.equal(dayVisualState(2, 1, 2), "hover");
  assert.equal(dayVisualState(0, 1, 2), "dimmed");
  // Hovering the selected day cannot demote it.
  assert.equal(dayVisualState(1, 1, 1), "active");
});


test("a walk between two stops on the same block still gets a visible bow", () => {
  // The floor is the whole reason it exists: 30m * 0.3 is 9m, which at any camera height that
  // fits a day is a straight line.
  assert.equal(arcLift(30), 80);
});

test("a cross-city hop peaks at a fraction of the ground it covers", () => {
  // 5km apart is the ordinary case — two neighbourhoods of one city — and this is the number
  // the whole redesign is about: high enough that two hops over the same ground separate.
  assert.equal(arcLift(5000), 1500);
});

test("an intercity leg is capped rather than leaving the atmosphere", () => {
  // 1000km at the raw ratio would be a 300km apex, which no camera framing both ends contains.
  assert.equal(arcLift(1_000_000), 30_000);
});

test("the lift is monotonic in distance across the whole clamped range", () => {
  const distances = [0, 10, 100, 267, 1_000, 5_000, 40_000, 99_999, 1e7];
  const lifts = distances.map(arcLift);
  for (let i = 1; i < lifts.length; i++) {
    assert.ok(lifts[i] >= lifts[i - 1], `${distances[i]}m lifted less than ${distances[i - 1]}m`);
  }
});

test("a NaN distance lifts to the floor rather than poisoning a vertex", () => {
  // A NaN position is the failure mode this guards: Cesium draws nothing and logs nothing.
  assert.equal(arcLift(NaN), 80);
  assert.equal(arcLift(Infinity), 80);
});

test("the model's own time format buckets into the right phase", () => {
  // "9:00 AM" is the shape STOP_SHAPE in itineraryPrompt.ts asks for, so it is the only one
  // that really has to work.
  assert.equal(dayPhase("6:30 AM"), "dawn");
  assert.equal(dayPhase("9:00 AM"), "day");
  assert.equal(dayPhase("4:45 PM"), "day");
  assert.equal(dayPhase("6:00 PM"), "dusk");
  assert.equal(dayPhase("8:30 PM"), "night");
  assert.equal(dayPhase("2:00 AM"), "night");
});

test("each band boundary belongs to the later phase", () => {
  // Pinned because these are the numbers the doc comment quotes, and a stop landing exactly on
  // one is common — the model writes times on the half hour.
  assert.equal(dayPhase("5:29 AM"), "night");
  assert.equal(dayPhase("5:30 AM"), "dawn");
  assert.equal(dayPhase("7:29 AM"), "dawn");
  assert.equal(dayPhase("7:30 AM"), "day");
  assert.equal(dayPhase("4:59 PM"), "day");
  // 5:00 PM sharp is golden hour, not afternoon — a viewpoint stop planned for then wants the
  // warm tint, which is the whole reason the dusk band starts this early.
  assert.equal(dayPhase("5:00 PM"), "dusk");
  assert.equal(dayPhase("7:29 PM"), "dusk");
  assert.equal(dayPhase("7:30 PM"), "night");
});

test("midnight and noon land on opposite sides, which is where a %12 goes wrong", () => {
  assert.equal(dayPhase("12:00 AM"), "night");
  assert.equal(dayPhase("12:00 PM"), "day");
});

test("a bare 24-hour time works too, since a chat edit can produce one", () => {
  assert.equal(dayPhase("19:30"), "night");
  assert.equal(dayPhase("06:15"), "dawn");
  assert.equal(dayPhase("13:00"), "day");
});

test("a missing or unreadable time gets daylight, i.e. no tint at all", () => {
  // Older saved itineraries, and anything the model phrased instead of clocked. Daylight is the
  // no-op: the tiles are daylight photography already.
  assert.equal(dayPhase(undefined), "day");
  assert.equal(dayPhase(""), "day");
  assert.equal(dayPhase("late afternoon"), "day");
  assert.equal(dayPhase("25:00"), "day");
  assert.equal(dayPhase("14:99"), "day");
  assert.equal(dayPhase("0:00 PM"), "day");
});

test("the phase reads a time embedded in a longer label", () => {
  // Nothing validates `Stop.time`, and the model has been known to pad it.
  assert.equal(dayPhase("around 7:00 PM"), "dusk");
  assert.equal(dayPhase("8:00 p.m."), "night");
});
